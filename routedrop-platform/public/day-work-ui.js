'use strict';
(function(root){
 const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function dayWork(rows,signedIn){
  const button=(id,action,label,extra='')=>'<button type="button" class="btn secondary" data-day-id="'+Number(id)+'" data-day-action="'+action+'" '+extra+'>'+label+'</button>';
  return '<section class="panel"><div class="eyebrow">LOCAL JOBS · PILOT</div><h2>Find Work</h2><p>Try posting yard cleanup, moving help or another one-time task. Use fictional details only. No money moves, real customers are not notified, and workers are not verified.</p><button class="btn" data-action="post-day-work">Post a Job</button>'+(signedIn?'<div class="opportunity-cards">'+(rows.length?rows.map(t=>'<article class="panel"><h3>'+esc(t.title)+'</h3><p>'+esc(t.city)+' · '+esc(t.pay_display)+'</p><p>'+esc(new Date(t.starts_at).toLocaleString())+' – '+esc(new Date(t.ends_at).toLocaleString())+'</p><p>'+esc(t.summary)+'</p><strong>'+esc(t.status.replaceAll('_',' '))+'</strong><div class="row">'+
   (t.is_poster&&t.status==='open'?button(t.id,'interests','View interested workers'):'')+
   (!t.is_poster&&t.status==='open'&&new Date(t.starts_at)>new Date()?button(t.id,t.interested?'withdraw':'interest',t.interested?'Withdraw interest':"I’m interested"):'')+
   (t.is_worker&&t.status==='assigned'?button(t.id,'complete','Mark work complete'):'')+
   (t.is_poster&&t.status==='awaiting_confirmation'?button(t.id,'confirm','Confirm work completed'):'')+
   (t.is_poster&&['open','assigned'].includes(t.status)?button(t.id,'cancel','Cancel test task'):'')+'</div></article>').join(''):'<p>No jobs posted yet.</p>')+'</div>':'<p>Sign in with a test account to browse tasks, post work or express interest.</p>')+'</section>';
 }
 function dayWorkForm(){
  return '<h2 id="modal-title">Post a Job</h2><p>Use a general city only. Leave out addresses, phone numbers and personal details. This private test does not arrange real work or collect payment.</p><form id="day-work-form">'+
   [['title','Task title','text',120],['city','City / general area','text',100],['payDisplay','Sample pay (e.g. $50 total)','text',80],['startsAt','Start time (your local time)','datetime-local',100],['endsAt','End time (your local time)','datetime-local',100]].map(([name,label,type,max])=>'<label for="day-'+name+'">'+label+'</label><input id="day-'+name+'" name="'+name+'" type="'+type+'" maxlength="'+max+'" required>').join('')+
   '<label for="day-summary">Fictional task description</label><textarea id="day-summary" name="summary" minlength="20" maxlength="1000" required></textarea><p class="error" id="form-error"></p><button class="btn" type="submit">Post job</button></form>';
 }
 function dayWorkers(id,rows){return '<h2 id="modal-title">Interested test workers</h2><p>Choose one test worker. This does not verify identity or move money.</p>'+ (rows.length?rows.map(w=>'<div class="row"><span>'+esc(w.label)+'</span><button class="btn" data-day-id="'+Number(id)+'" data-day-action="select" data-worker-id="'+Number(w.workerId)+'">Select worker</button></div>').join(''):'<p>No interest yet. Use another test account to express interest.</p>');}

 root.RouteDropDayWork=Object.freeze({dayWork,dayWorkForm,dayWorkers});
})(window);
