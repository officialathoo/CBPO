/**
 * XBPO forms client. Public code; no credentials should be placed in this file.
 * Cross-origin Apps Script redirects mean a normal fetch cannot reliably read the POST result.
 * We POST through an invisible iframe, then check the receipt ID through a minimal, read-only
 * JSONP status endpoint. Success is shown ONLY after the backend confirms sheet storage.
 */
(() => {
  'use strict';
  const MAX_CV_BYTES = 3 * 1024 * 1024;
  const allowedExtensions = new Set(['pdf','doc','docx']);
  const endpoint = (window.XBPO_CONFIG && window.XBPO_CONFIG.appsScriptUrl || '').trim();
  const configured = /^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(endpoint);
  const formItems = [
    {form:document.getElementById('contactForm'),type:'contact',status:document.getElementById('contactStatus')},
    {form:document.getElementById('careerForm'),type:'career',status:document.getElementById('careerStatus')}
  ];

  function receipt() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else throw Error('Your browser cannot securely create an application receipt ID.');
    return Array.from(bytes, byte => byte.toString(16).padStart(2,'0')).join('');
  }
  function setMessage(element,text,state='') {
    if (!element) return;
    element.textContent=text;
    element.classList.remove('is-error','is-success','is-pending');
    if(state) element.classList.add(`is-${state}`);
  }
  function base64Of(file) {
    return new Promise((resolve,reject)=>{
      const reader = new FileReader();
      reader.onload=()=>resolve(String(reader.result).split(',')[1]);
      reader.onerror=()=>reject(Error('Unable to read the selected CV.'));
      reader.readAsDataURL(file);
    });
  }
  function statusLookup(id) {
    return new Promise((resolve,reject)=>{
      const name = 'XBPO_STATUS_'+id.replace(/-/g,'_');
      const script = document.createElement('script');
      let done=false;
      const timer=setTimeout(()=>finish(Error('Status check timed out.')),7000);
      function finish(error,data) {
        if(done)return;done=true;clearTimeout(timer);delete window[name];script.remove();
        if(error)reject(error);else resolve(data);
      }
      window[name]=data=>finish(null,data);
      script.onerror=()=>finish(Error('Status service unreachable.'));
      script.src=endpoint+'?request_id='+encodeURIComponent(id)+'&callback='+encodeURIComponent(name)+'&_='+Date.now();
      document.head.appendChild(script);
    });
  }
  function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
  async function waitForReceipt(id) {
    // A slow Apps Script deployment can take more than ten seconds to start.
    const end=Date.now()+45000;
    await wait(1800);
    while(Date.now()<end) {
      try {
        const result=await statusLookup(id);
        if(result && result.state==='ok')return result;
        if(result && result.state==='error')throw Error(result.message || 'The server rejected this submission.');
      } catch (err) {
        if(err.message!=='Status service unreachable.' && err.message!=='Status check timed out.')throw err;
      }
      await wait(1700);
    }
    throw Error('Delivery could not be verified. Check the Google Sheet before sending again.');
  }
  function submitViaFrame(fields,action,id) {
    const frame=document.createElement('iframe');frame.name='xbpo_frame_'+id;frame.title='Submission transport';frame.style.display='none';
    const transport=document.createElement('form');transport.method='POST';transport.action=action;transport.target=frame.name;transport.style.display='none';transport.acceptCharset='UTF-8';
    Object.entries(fields).forEach(([key,val])=>{
      const hidden=document.createElement('input');hidden.type='hidden';hidden.name=key;hidden.value=val == null ? '' : String(val);transport.appendChild(hidden);
    });
    document.body.appendChild(frame);document.body.appendChild(transport);
    transport.submit();
    // The POST completion is NOT inferred from iframe load; only the receipt endpoint confirms it.
    setTimeout(()=>{transport.remove();frame.remove();},65000);
  }
  for (const item of formItems) {
    if(!item.form)continue;
    const form=item.form;
    const resumeInput=form.querySelector('input[name=resume]');
    if(resumeInput)resumeInput.addEventListener('change',()=>{
      const name=resumeInput.files && resumeInput.files[0] && resumeInput.files[0].name || 'Choose a file';
      document.getElementById('resumeLabel').textContent=name;
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(!form.checkValidity()) {form.reportValidity();return;}
      if(form.elements.website && form.elements.website.value) return;
      if(!configured){setMessage(item.status,'Preview mode: connect the Google Apps Script URL in config.js before submissions can be received.','error');return;}
      const button=form.querySelector('button[type=submit]');
      const original=button.innerHTML;
      const fields=Object.fromEntries(new FormData(form).entries());
      delete fields.resume;
      if(item.type==='career'){
        const cv=resumeInput && resumeInput.files && resumeInput.files[0];
        if(!cv){setMessage(item.status,'Please choose your CV.','error');return;}
        const ext=cv.name.split('.').pop().toLowerCase();
        if(!allowedExtensions.has(ext) || cv.size===0 || cv.size>MAX_CV_BYTES) {
          setMessage(item.status,'Choose a PDF, DOC or DOCX CV no larger than 3 MB.','error');return;
        }
        // Extensions and MIME are validated again on the server, including file signatures.
        fields.resumeName=cv.name;
        fields.resumeMime=cv.type||'';
        try{fields.resumeBase64=await base64Of(cv);}catch(err){setMessage(item.status,err.message,'error');return;}
      }
      let id;
      try{id=receipt();}catch(err){setMessage(item.status,err.message,'error');return;}
      fields.formType=item.type;
      fields.requestId=id;
      button.disabled=true;
      button.textContent='Sending…';
      setMessage(item.status,'Submitting securely and checking delivery…','pending');
      try {
        submitViaFrame(fields,endpoint,id);
        const result=await waitForReceipt(id);
        if(result.state==='ok'){
          form.reset();
          if(resumeInput)document.getElementById('resumeLabel').textContent='Choose a file';
          const msg=item.type==='career' ? 'Application received. Your details and CV were saved for recruitment review.' : 'Enquiry received. Your details were saved for follow-up.';
          setMessage(item.status,result.emailSent===false ? msg+' Email notification could not be delivered; the team can find your submission in its Google Sheet.' : msg,'success');
        }
      }catch(err){setMessage(item.status,err.message||'Submission failed. Try again later.','error');}
      finally{button.disabled=false;button.innerHTML=original;}
    });
  }
})();
