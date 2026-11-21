const dialog=document.getElementById("createDialog");
const form=document.getElementById("postForm");
function openComposer(){if(dialog&&!dialog.open)dialog.showModal();}
document.getElementById("storyCreate")?.addEventListener("click",openComposer);
document.getElementById("notificationBtn")?.addEventListener("click",()=>{
  let notice=document.getElementById("gramoraNotice");
  if(!notice){notice=document.createElement("div");notice.id="gramoraNotice";notice.style.cssText="position:fixed;z-index:2000;top:72px;right:14px;background:#20232a;color:#fff;border:1px solid #383b45;border-radius:12px;padding:12px 16px;box-shadow:0 8px 28px #0008;font:13px Arial";document.body.append(notice);}
  notice.textContent="You're all caught up. Notifications are coming soon.";
  notice.hidden=false;clearTimeout(window.gramoraNoticeTimer);window.gramoraNoticeTimer=setTimeout(()=>notice.hidden=true,2600);
});
["openCreate","rightCreate","rightCreateDesktop","mobileCreate","topCreate"].forEach(id=>document.getElementById(id)?.addEventListener("click",openComposer));
document.getElementById("themeBtn")?.addEventListener("click",()=>{
  document.body.classList.toggle("light");
  const dark=document.body.classList.contains("light");
  document.getElementById("themeBtn").textContent=dark?"☾":"☼";
});
function showPlaceholder(view,title){
  const feed=document.getElementById("feed");
  feed.replaceChildren();
  const card=document.createElement("div");card.className="empty-welcome";
  const mark=document.createElement("div");mark.className="welcome-symbol";mark.textContent="g.";
  const eyebrow=document.createElement("p");eyebrow.className="eyebrow";eyebrow.textContent=view==="messages"?"COMING SOON":"YOUR SPACE";
  const heading=document.createElement("h2");heading.textContent=view==="messages"?"Conversations are on their way.":view==="saved"?"Your saved posts will live here.":"Discover something new.";
  const note=document.createElement("p");note.textContent=view==="messages"?"We’re getting your private conversations ready. This space will be connected in a future GRAMORA update.":view==="saved"?"Save posts you love and come back to them anytime.":"Explore and connect with the GRAMORA community. More discovery features are coming soon.";
  card.append(mark,eyebrow,heading,note);
  if(view==="explore"||view==="saved"){const button=document.createElement("button");button.className="create-btn";button.type="button";button.textContent="Back to home";button.addEventListener("click",()=>document.querySelector('[data-view="home"]')?.click());card.append(button);}
  feed.append(card);
}
document.querySelectorAll(".nav").forEach(button=>button.addEventListener("click",()=>{
  const view=button.dataset.view;
  document.body.classList.toggle("profile-active",view==="profile");
  document.querySelectorAll(".nav").forEach(item=>item.classList.toggle("active",item.dataset.view===view));
  const titles={home:"Your feed",explore:"Explore",messages:"Messages",saved:"Saved posts",profile:"My profile"};
  document.getElementById("viewTitle").textContent=titles[view]||"Your feed";
  if(view!=="home"&&view!=="profile")showPlaceholder(view,titles[view]);
  document.dispatchEvent(new CustomEvent("gramora:view",{detail:view}));
}));
document.addEventListener("click",event=>{
  const like=event.target.closest(".like");
  if(like){like.classList.toggle("liked");like.innerHTML=like.classList.contains("liked")?"♥ <span>Liked</span>":"♡ <span>Like</span>";}
  const save=event.target.closest(".save");
  if(save){save.classList.toggle("saved");save.innerHTML=save.classList.contains("saved")?"✓ <span>Saved</span>":"▣ <span>Save</span>";}
});