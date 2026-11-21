const dialog=document.getElementById('createDialog');
const form=document.getElementById('postForm');
function openComposer(){dialog.showModal()}
document.getElementById('openCreate').addEventListener('click',openComposer);
document.getElementById('rightCreate').addEventListener('click',openComposer);
document.getElementById('themeBtn').addEventListener('click',()=>document.body.classList.toggle('light'));
document.querySelectorAll('.nav').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('.nav').forEach(item=>item.classList.remove('active'));
  button.classList.add('active');
  const view=button.dataset.view;
  const titles={home:'Home feed',explore:'Explore',messages:'Messages',saved:'Saved posts',profile:'Your profile'};
  document.getElementById('viewTitle').textContent=titles[view]||'Home feed';
  if(view!=='home'&&view!=='profile'){
    document.getElementById('feed').innerHTML='<div class="welcome-card"><p class="eyebrow">COMING NEXT</p><h2>'+titles[view]+'</h2><p>This section will be connected in the next GRAMORA development phase.</p></div>';
  }
  document.dispatchEvent(new CustomEvent('gramora:view',{detail:view}));
}));
document.addEventListener('click',event=>{
  const like=event.target.closest('.like');
  if(like){like.classList.toggle('liked');like.firstChild.textContent=like.classList.contains('liked')?'♥ ':'♡ ';like.style.color=like.classList.contains('liked')?'#d6ff6b':''}
  const save=event.target.closest('.save');
  if(save){save.classList.toggle('saved');save.style.color=save.classList.contains('saved')?'#d6ff6b':''}
});
