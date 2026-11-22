/**
 * XBPO Careers + Business Enquiries / Google Apps Script backend.
 * Paste into a Google Apps Script project owned by XBPO.
 * Set IDs and inboxes below. Deploy as: Web app / Execute as Me / Who has access: Anyone.
 * A public endpoint needs additional production anti-spam protection before large campaigns.
 */
const SETTINGS = Object.freeze({
  SPREADSHEET_ID: 'PASTE_GOOGLE_SHEET_ID',
  RESUME_FOLDER_ID: 'PASTE_GOOGLE_DRIVE_FOLDER_ID',
  HR_EMAIL: 'xbpocommunications@gmail.com',
  SALES_EMAIL: 'xbpocommunications@gmail.com',
  MAX_RESUME_BYTES: 3 * 1024 * 1024,
  COOLDOWN_SECONDS: 90
});

const APPLICATION_HEADERS = [
  'Received at (UTC)', 'Receipt', 'Name', 'Email', 'Phone', 'City', 'Role',
  'Experience', 'Education', 'Portfolio', 'Introduction',
  'Private CV URL', 'Email notification', 'Consent'
];
const ENQUIRY_HEADERS = [
  'Received at (UTC)', 'Receipt', 'Name', 'Email', 'Phone', 'Company',
  'Service', 'Message', 'Email notification', 'Consent'
];

/** JSONP returns only a receipt's generic state, never any applicant data. */
function doGet(e) {
  const p = e && e.parameter || {};
  if (!p.request_id || !p.callback) {
    return ContentService.createTextOutput('XBPO form service').setMimeType(ContentService.MimeType.TEXT);
  }
  const id = String(p.request_id);
  const callback = String(p.callback);
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(id) || !/^XBPO_STATUS_[A-Za-z0-9_]{16,90}$/.test(callback)) {
    return ContentService.createTextOutput('Invalid request').setMimeType(ContentService.MimeType.TEXT);
  }
  const cached = CacheService.getScriptCache().get('status_' + id);
  const result = cached ? JSON.parse(cached) : {state:'pending'};
  return ContentService.createTextOutput(callback + '(' + JSON.stringify(result) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function doPost(e) {
  const p = e && e.parameter || {};
  const id = String(p.requestId || '');
  let lock;
  let acquired = false;
  try {
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(id)) throw Error('Invalid receipt ID.');
    if (p.website) throw Error('Invalid request.'); // Honeypot: bot submission.
    const type = String(p.formType || '');
    if (!['career','contact'].includes(type)) throw Error('Invalid submission type.');
    verifyConfiguration_(type);
    lock=LockService.getScriptLock();
    lock.waitLock(25000);
    acquired=true;
    const cache=CacheService.getScriptCache();
    const old=cache.get('status_'+id);
    if (old) return hiddenReply_(); // Repeat post with same receipt cannot insert again.
    const person=readPerson_(p,type);
    const spamKey='cooldown_'+hash_(person.email.toLowerCase()+'|'+type);
    if (cache.get(spamKey)) throw Error('Please wait before submitting another form.');
    const sheetFile=SpreadsheetApp.openById(SETTINGS.SPREADSHEET_ID);
    let emailSent=false;
    if(type==='career'){
      const file=saveCv_(p,id);
      let sheet;
      try {
        sheet=getSheet_(sheetFile,'Applications',APPLICATION_HEADERS);
        sheet.appendRow([
          new Date(),id,cell_(person.fullName),cell_(person.email),cell_(person.phone),
          cell_(person.city),cell_(person.role),cell_(person.experience),
          cell_(person.education),cell_(person.portfolio),cell_(person.message),file.getUrl(),
          'Pending', 'Yes'
        ]);
      } catch(err) {
        try{file.setTrashed(true);}catch(ignore){}
        throw err;
      }
      const row=sheet.getLastRow();
      try {
        MailApp.sendEmail({
          to:SETTINGS.HR_EMAIL,replyTo:person.email,name:'XBPO Careers',
          subject:'XBPO application | '+person.role+' | '+person.fullName,
          body:[
            'A new XBPO application was saved to the Applications sheet.',
            'Receipt: '+id,'Name: '+person.fullName,'Email: '+person.email,
            'Phone: '+person.phone,'City: '+person.city,'Role: '+person.role,
            'Experience: '+person.experience,
            'Education: '+person.education,'Portfolio: '+person.portfolio,
            'Introduction: '+person.message,
            'Private Drive CV: '+file.getUrl(),
            'The CV is attached for recipients without Drive-folder access.'
          ].join('\n'),attachments:[file.getBlob()]
        });
        emailSent=true;
      } catch(mailError) {
        console.error('Mail failed after CV and row were saved',mailError);
      }
      sheet.getRange(row,13).setValue(emailSent ? 'Sent' : 'Failed; review Apps Script logs');
    } else {
      const sheet=getSheet_(sheetFile,'Inquiries',ENQUIRY_HEADERS);
      sheet.appendRow([
        new Date(),id,cell_(person.fullName),cell_(person.email),cell_(person.phone),
        cell_(person.company),cell_(person.service),cell_(person.message),'Pending','Yes'
      ]);
      const row=sheet.getLastRow();
      try {
        MailApp.sendEmail({
          to:SETTINGS.SALES_EMAIL,replyTo:person.email,name:'XBPO Website',
          subject:'XBPO business enquiry | '+person.service,
          body:[
            'A new business enquiry was saved to the Inquiries sheet.',
            'Receipt: '+id,'Name: '+person.fullName,'Email: '+person.email,
            'Phone: '+person.phone,'Company: '+person.company,
            'Service: '+person.service,'Message: '+person.message
          ].join('\n')
        });
        emailSent=true;
      } catch(mailError){console.error('Enquiry notification failed',mailError);}
      sheet.getRange(row,9).setValue(emailSent ? 'Sent' : 'Failed; review Apps Script logs');
    }
    cache.put(spamKey,'1',SETTINGS.COOLDOWN_SECONDS);
    cache.put('status_'+id,JSON.stringify({state:'ok',emailSent:emailSent}),600);
  } catch (err) {
    // Report only a safe, generic status publicly. Detailed errors stay in Apps Script logs.
    console.error('XBPO form error',err);
    if (/^[A-Za-z0-9_-]{16,80}$/.test(id)) {
      const safe = /^Please wait before submitting/.test(err.message)
        ? err.message : 'The submission was not confirmed. Contact XBPO if the problem persists.';
      CacheService.getScriptCache().put('status_'+id,JSON.stringify({state:'error',message:safe}),600);
    }
  } finally {
    if (acquired) lock.releaseLock();
  }
  return hiddenReply_();
}

function hiddenReply_(){
  return HtmlService.createHtmlOutput('<!doctype html><title>XBPO form received</title><p>Submission request processed.</p>');
}
function verifyConfiguration_(type){
  if (SETTINGS.SPREADSHEET_ID.indexOf('PASTE_')===0) throw Error('Missing Spreadsheet ID.');
  if (type==='career' && SETTINGS.RESUME_FOLDER_ID.indexOf('PASTE_')===0) throw Error('Missing CV folder ID.');
  if (type==='career' && !emailOk_(SETTINGS.HR_EMAIL)) throw Error('Missing recruitment inbox.');
  if (type==='contact' && !emailOk_(SETTINGS.SALES_EMAIL)) throw Error('Missing business inbox.');
}
function emailOk_(s){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s||''));}
function text_(v,max){return String(v==null?'':v).trim().slice(0,max).replace(/\u0000/g,'');}
function required_(s,label){if(!s)throw Error('Missing '+label+'.');return s;}
function readPerson_(p,type){
  if(String(p.consent||'')!=='on')throw Error('Consent required.');
  const person={
    fullName:required_(text_(p.fullName,100),'name'),
    email:required_(text_(p.email,150),'email'),
    phone:text_(p.phone,32),city:text_(p.city,100),role:text_(p.role,100),
    experience:text_(p.experience,50),education:text_(p.education,120),
    portfolio:text_(p.portfolio,250),company:text_(p.company,120),service:text_(p.service,100),
    message:text_(p.message,type==='career'?2000:3000)
  };
  if(person.fullName.length<2 || !emailOk_(person.email))throw Error('Invalid name or email.');
  if(type==='career'){
    required_(person.phone,'phone');required_(person.city,'city');
    required_(person.role,'role');required_(person.experience,'experience');
    if(!/^[+0-9() .-]{10,32}$/.test(person.phone))throw Error('Invalid phone number.');
    if(person.portfolio && !/^https?:\/\//i.test(person.portfolio))throw Error('Invalid portfolio URL.');
  }else{required_(person.service,'service');required_(person.message,'message');}
  return person;
}
function getSheet_(file,name,headers){
  let sheet=file.getSheetByName(name);
  if(!sheet)sheet=file.insertSheet(name);
  if(sheet.getLastRow()===0){
    sheet.appendRow(headers);
    sheet.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#d7bea0');
    sheet.setFrozenRows(1);
  }
  return sheet;
}
function saveCv_(p,id){
  const filename=text_(p.resumeName,200);
  const extension=(filename.split('.').pop()||'').toLowerCase();
  const mimeByExt={
    pdf:'application/pdf',doc:'application/msword',
    docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };
  if(!mimeByExt[extension] || !p.resumeBase64)throw Error('A valid CV is required.');
  // Do not trust browser-declared MIME or file extension alone.
  if(!/^[a-zA-Z0-9+/=\s]+$/.test(String(p.resumeBase64)))throw Error('Invalid file encoding.');
  const bytes=Utilities.base64Decode(String(p.resumeBase64));
  if(bytes.length<8||bytes.length>SETTINGS.MAX_RESUME_BYTES)throw Error('Invalid CV size.');
  const first=bytes.slice(0,8).map(x=>x&255);
  const pdf=first[0]===37&&first[1]===80&&first[2]===68&&first[3]===70&&first[4]===45;
  const zip=first[0]===80&&first[1]===75&&[3,5,7].includes(first[2]);
  const doc=first[0]===208&&first[1]===207&&first[2]===17&&first[3]===224;
  if(!((extension==='pdf'&&pdf)||(extension==='docx'&&zip)||(extension==='doc'&&doc)))throw Error('File type mismatch.');
  const safe=filename.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100);
  const name=new Date().toISOString().replace(/[:.]/g,'-')+'_'+id.slice(0,8)+'_'+safe;
  const blob=Utilities.newBlob(bytes,mimeByExt[extension],name);
  // Files remain PRIVATE in the specified folder. We email HR an attachment as well.
  return DriveApp.getFolderById(SETTINGS.RESUME_FOLDER_ID).createFile(blob);
}
function cell_(value){
  const str=String(value==null?'':value);
  // Prefix potential formulas so user-provided values are stored as plain spreadsheet text.
  return /^[\s]*[=+\-@]/.test(str) ? "'"+str : str;
}
function hash_(str){
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,str)
    .map(x=>('0'+(x&255).toString(16)).slice(-2)).join('');
}
