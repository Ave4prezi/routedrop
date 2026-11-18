'use strict';
(function(root){
 const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const sampleJobs=Object.freeze([
  {id:-201,title:'Weekend Lawn Care Crew',category:'Services',city:'Decatur, AL',employment_type:'Part-time',pay_display:'Example: $18–$22/hr',summary:'Fictional opportunity helping a neighborhood lawn-care crew with mowing and edging on weekends.',employer_name:'Greenline Outdoor Co.'},
  {id:-202,title:'Warehouse Team Associate',category:'Warehousing',city:'Huntsville, AL',employment_type:'Full-time',pay_display:'Example: $19/hr',summary:'Fictional warehouse role featuring inventory organization, shipping support and safe material handling.',employer_name:'North Valley Supply'},
  {id:-203,title:'Cafe Counter Associate',category:'Food & Hospitality',city:'Decatur, AL',employment_type:'Seasonal',pay_display:'Example: $15/hr',summary:'Fictional local cafe role supporting guests, order preparation and morning service.',employer_name:'Riverbend Cafe'}
 ]);
 function jobs(rows,preview,query=''){
  const find=String(query||'').trim().toLowerCase();
  const visible=rows.filter(x=>!find||[x.title,x.category,x.city,x.employment_type,x.employer_name].join(' ').toLowerCase().includes(find));
  return '<div class="pilot-banner"><div class="eyebrow">FIND WORK · PRIVATE TEST</div><h2>Two ways to find opportunity.</h2><p>Explore example employment openings or set up a profile to offer your own services. No real applications, résumés or hiring decisions happen in this preview.</p></div>'+
   '<div class="opportunity-paths"><article><span>01 · FIND EMPLOYMENT</span><h3>Browse open positions</h3><p>Explore employer-posted test roles in services, warehouses, hospitality and other industries.</p></article>'+
   '<article><span>02 · OFFER YOUR SKILLS</span><h3>Work independently</h3><p>Post lawn care, cleaning or other available services as an individual—no registered company required for a test profile.</p><button type="button" class="btn secondary" data-action="register-individual">Try individual provider signup</button></article></div>'+
   '<div class="pilot-heading"><h2>Job opportunities</h2><span id="job-visible-count">'+visible.length+' '+(preview?'fictional example':'test posting')+(visible.length===1?'':'s')+'</span></div>'+
   '<label for="job-search" class="sr-only">Search jobs, employers or cities</label><input class="opportunity-search" id="job-search" type="search" autocomplete="off" placeholder="Search roles, categories or cities" value="'+esc(query)+'">'+
   '<p class="opportunity-disclosure">All postings are fictional or submitted by test employers in this password-protected pilot. Employers are not verified. Applying is disabled; never submit personal information here.</p>'+
   '<div class="opportunity-cards">'+(visible.length?visible.map(j=>'<article class="opportunity-card"><span class="pilot-eyebrow">'+esc(j.category)+' · '+esc(j.employment_type)+'</span><h3>'+esc(j.title)+'</h3><p class="opportunity-employer">'+esc(j.employer_name)+' · '+esc(j.city)+'</p><strong class="opportunity-pay">'+esc(j.pay_display)+'</strong><p>'+esc(j.summary.length>170?j.summary.slice(0,167)+'…':j.summary)+'</p><button type="button" class="btn secondary" data-job-detail="'+Number(j.id)+'">View test opening</button></article>').join(''):'<div class="panel">No matching test roles. Try another search.</div>')+'</div>';
 }
 function details(j){
  return '<div class="pilot-eyebrow">FICTIONAL OR TEST POSTING · NO APPLICATIONS</div><h2 id="modal-title">'+esc(j.title)+'</h2><p>'+esc(j.employer_name)+' · '+esc(j.city)+'</p><div class="pilot-summary"><strong>'+esc(j.employment_type)+'</strong><span>'+esc(j.category)+'</span><span>'+esc(j.pay_display)+'</span></div><p>'+esc(j.summary)+'</p><p class="legal">This is not a live job offer. No applicant information, résumés, employment verification or applications are accepted.</p>';
 }
 function employerPanel(rows,kind){
  if(kind==='individual')return '<div class="panel"><h3>Your individual provider profile</h3><p class="muted">You can publish your own fictional service openings with Business Studio. Employer hiring tools require a separate business/employer test account in this early pilot.</p></div>';
  return '<div class="panel opportunity-manage"><div class="row"><div><h3>Recruiting & job openings</h3><p class="muted">Publish fictional employment opportunities for the private test. Applicant collection is disabled.</p></div><button class="btn" data-action="post-job">+ Post a test job</button></div>'+
    (rows.length?rows.map(j=>'<div class="pilot-listing-row"><div><strong>'+esc(j.title)+'</strong><p>'+esc(j.city)+' · '+esc(j.employment_type)+' · '+esc(j.pay_display)+'</p></div><div><span class="pilot-status">'+esc(j.status)+'</span><button type="button" class="btn secondary" data-job-status-id="'+Number(j.id)+'" data-job-status="'+(j.status==='active'?'paused':'active')+'">'+(j.status==='active'?'Pause':'Resume')+'</button></div></div>').join(''):'<p class="muted">No test job posts yet. Your first posting will appear in Find Work.</p>')+'</div>';
 }
 function form(){
  return '<div class="pilot-eyebrow">EMPLOYER TEST · NO APPLICANTS</div><h2 id="modal-title">Publish a fictional job</h2>'+
   '<p>Create a test-only employment opening. Do not post a real vacancy or include contact details, emails, external application links or sensitive information.</p>'+
   '<form id="job-form"><label>Job title</label><input name="title" required minlength="4" maxlength="120" placeholder="Weekend lawn-care crew">'+
   '<label>Industry</label><select name="category"><option>Services</option><option>Warehousing</option><option>Retail</option><option>Food &amp; Hospitality</option><option>Healthcare</option><option>Construction</option><option>Other</option></select>'+
   '<label>City</label><input name="city" required minlength="3" maxlength="100" placeholder="Decatur, AL">'+
   '<label>Employment type</label><select name="employmentType"><option>Part-time</option><option>Full-time</option><option>Contract</option><option>Seasonal</option></select>'+
   '<label>Sample pay (not guaranteed)</label><input name="payDisplay" required minlength="2" maxlength="80" placeholder="Example: $18–$22/hr">'+
   '<label>Fictional job summary</label><textarea name="summary" required minlength="20" maxlength="1000" rows="4" placeholder="Describe the sample responsibilities and schedule."></textarea>'+
   '<p class="legal">No applications, interviews, financial transactions or applicant data collection are enabled.</p><p id="form-error" class="error"></p>'+
   '<button type="submit" class="btn">Publish test job</button></form>';
 }
 function dayWork(rows,signedIn){
  const button=(id,action,label,extra='')=>'<button type="button" class="btn secondary" data-day-id="'+Number(id)+'" data-day-action="'+action+'" '+extra+'>'+label+'</button>';
  return '<section class="panel"><div class="eyebrow">LOCAL DAY WORK · PRIVATE TEST</div><h2>Small jobs. Local opportunities.</h2><p>Try posting yard cleanup, moving help or another one-time task. Use fictional details only. No money moves, real customers are not notified, and workers are not verified.</p><button class="btn" data-action="post-day-work">+ Post a test task</button>'+(signedIn?'<div class="opportunity-cards">'+(rows.length?rows.map(t=>'<article class="panel"><h3>'+esc(t.title)+'</h3><p>'+esc(t.city)+' · '+esc(t.pay_display)+'</p><p>'+esc(new Date(t.starts_at).toLocaleString())+' – '+esc(new Date(t.ends_at).toLocaleString())+'</p><p>'+esc(t.summary)+'</p><strong>'+esc(t.status.replaceAll('_',' '))+'</strong><div class="row">'+
   (t.is_poster&&t.status==='open'?button(t.id,'interests','View interested workers'):'')+
   (!t.is_poster&&t.status==='open'&&new Date(t.starts_at)>new Date()?button(t.id,t.interested?'withdraw':'interest',t.interested?'Withdraw interest':"I’m interested"):'')+
   (t.is_worker&&t.status==='assigned'?button(t.id,'complete','Mark work complete'):'')+
   (t.is_poster&&t.status==='awaiting_confirmation'?button(t.id,'confirm','Confirm work completed'):'')+
   (t.is_poster&&['open','assigned'].includes(t.status)?button(t.id,'cancel','Cancel test task'):'')+'</div></article>').join(''):'<p>No test tasks yet. Post the first one.</p>')+'</div>':'<p>Sign in with a test account to browse tasks, post work or express interest.</p>')+'</section>';
 }
 function dayWorkForm(){
  return '<h2 id="modal-title">Post a fictional day-work task</h2><p>Use a general city only. Leave out addresses, phone numbers and personal details. This private test does not arrange real work or collect payment.</p><form id="day-work-form">'+
   [['title','Task title','text',120],['city','City / general area','text',100],['payDisplay','Sample pay (e.g. $50 total)','text',80],['startsAt','Start time (your local time)','datetime-local',100],['endsAt','End time (your local time)','datetime-local',100]].map(([name,label,type,max])=>'<label for="day-'+name+'">'+label+'</label><input id="day-'+name+'" name="'+name+'" type="'+type+'" maxlength="'+max+'" required>').join('')+
   '<label for="day-summary">Fictional task description</label><textarea id="day-summary" name="summary" minlength="20" maxlength="1000" required></textarea><p class="error" id="form-error"></p><button class="btn" type="submit">Post test task</button></form>';
 }
 function dayWorkers(id,rows){return '<h2 id="modal-title">Interested test workers</h2><p>Choose one test worker. This does not verify identity or move money.</p>'+ (rows.length?rows.map(w=>'<div class="row"><span>'+esc(w.label)+'</span><button class="btn" data-day-id="'+Number(id)+'" data-day-action="select" data-worker-id="'+Number(w.workerId)+'">Select worker</button></div>').join(''):'<p>No interest yet. Use another test account to express interest.</p>');}

 root.RouteDropOpportunities=Object.freeze({sampleJobs,jobs,details,employerPanel,form,dayWork,dayWorkForm,dayWorkers});
})(window);
