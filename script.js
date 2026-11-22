const dialog=document.getElementById("createDialog");
const form=document.getElementById("postForm");
function openComposer(){if(dialog&&!dialog.open)dialog.showModal();}
["openCreate","rightCreate","rightCreateDesktop","mobileCreate","topCreate"].forEach(id=>document.getElementById(id)?.addEventListener("click",openComposer));
// Restore the user's saved theme before wiring the theme toggle.
const themeButton=document.getElementById("themeBtn");
function applyTheme(theme){
  const useLight=theme==="light";
  document.body.classList.toggle("light",useLight);
  if(themeButton){
    themeButton.textContent=useLight?"☾":"☼";
    themeButton.setAttribute("aria-label",useLight?"Switch to dark theme":"Switch to light theme");
    themeButton.setAttribute("title",useLight?"Switch to dark theme":"Switch to light theme");
  }
}
let savedTheme="dark";
try{savedTheme=localStorage.getItem("gramora-theme")||"dark";}catch(error){}
applyTheme(savedTheme);
themeButton?.addEventListener("click",()=>{
  const nextTheme=document.body.classList.contains("light")?"dark":"light";
  applyTheme(nextTheme);
  try{localStorage.setItem("gramora-theme",nextTheme);}catch(error){}
});
function showPlaceholder(view,title){
  const feed=document.getElementById("feed");
  feed.replaceChildren();
  if(view==="messages"){
    const page=document.createElement("section");page.className="gramora-inbox";
    const head=document.createElement("div");head.className="gramora-inbox-head";
    const titleBox=document.createElement("div");
    const eyebrow=document.createElement("p");eyebrow.className="eyebrow";eyebrow.textContent="PRIVATE CONVERSATIONS";
    const heading=document.createElement("h2");heading.textContent="Messages";
    const subtitle=document.createElement("p");subtitle.className="gramora-inbox-subtitle";subtitle.textContent="Connect privately with people on GRAMORA.";
    titleBox.append(eyebrow,heading,subtitle);head.append(titleBox);page.append(head);
    const searchWrap=document.createElement("label");searchWrap.className="gramora-inbox-search";
    const searchIcon=document.createElement("span");searchIcon.textContent="⌕";searchIcon.setAttribute("aria-hidden","true");
    const search=document.createElement("input");search.type="search";search.placeholder="Search conversations";search.setAttribute("aria-label","Search conversations");search.disabled=true;
    searchWrap.append(searchIcon,search);page.append(searchWrap);
    const empty=document.createElement("div");empty.className="gramora-inbox-empty";
    const icon=document.createElement("div");icon.className="gramora-inbox-empty-icon";icon.textContent="✉";
    const emptyTitle=document.createElement("h3");emptyTitle.textContent="Your messages will appear here";
    const emptyText=document.createElement("p");emptyText.textContent="Your private chats are being set up. Soon you’ll be able to message people directly.";
    empty.append(icon,emptyTitle,emptyText);page.append(empty);feed.append(page);return;
  }
  const card=document.createElement("div");card.className="empty-welcome";
  const mark=document.createElement("div");mark.className="welcome-symbol";mark.textContent="g.";
  const eyebrow=document.createElement("p");eyebrow.className="eyebrow";eyebrow.textContent="YOUR SPACE";
  const heading=document.createElement("h2");heading.textContent=view==="saved"?"Your saved posts will live here.":"Discover something new.";
  const note=document.createElement("p");note.textContent=view==="saved"?"Save posts you love and come back to them anytime.":"Explore and connect with the GRAMORA community. More discovery features are coming soon.";
  card.append(mark,eyebrow,heading,note);
  if(view==="explore"||view==="saved"){const button=document.createElement("button");button.className="create-btn";button.type="button";button.textContent="Back to home";button.addEventListener("click",()=>document.querySelector('[data-view="home"]')?.click());card.append(button);}
  feed.append(card);
}
document.querySelectorAll(".nav").forEach(button=>button.addEventListener("click",()=>{
  const view=button.dataset.view;
  if(!view)return;
  document.body.classList.remove("view-home","view-explore","view-messages","view-saved","view-profile");
  document.body.classList.add("view-"+view);
  document.body.classList.toggle("profile-active",view==="profile");
  document.querySelectorAll(".nav").forEach(item=>item.classList.toggle("active",item.dataset.view===view));
  const titles={home:"Your feed",explore:"Explore",messages:"Messages",saved:"Saved posts",profile:"My profile"};
  document.getElementById("viewTitle").textContent=titles[view]||"Your feed";
  if(view!=="home"&&view!=="profile"&&view!=="explore")showPlaceholder(view,titles[view]);
  document.dispatchEvent(new CustomEvent("gramora:view",{detail:view}));
}));
document.addEventListener("click",event=>{
  const like=event.target.closest(".like");
  if(like){like.classList.toggle("liked");like.innerHTML=like.classList.contains("liked")?"♥ <span>Liked</span>":"♡ <span>Like</span>";}
});