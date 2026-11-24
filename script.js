const dialog=document.getElementById("createDialog");
const form=document.getElementById("postForm");
function openComposer(){gramoraCurrentPage="create";if(dialog&&!dialog.open)dialog.showModal();}
["openCreate","rightCreate","rightCreateDesktop","mobileCreate","topCreate"].forEach(id=>document.getElementById(id)?.addEventListener("click",openComposer));
// Restore the user's saved theme before wiring the theme toggle.
const themeButton=document.getElementById("themeBtn");
function applyTheme(theme){
  const useLight=theme==="light";
  document.body.classList.toggle("light",useLight);
  if(themeButton){
    // Shared SVG icon scanner updates the theme icon from the body class.
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
  if(view==="messages"&&!document.getElementById("gramora-inbox-inline-style")){
    const inboxStyle=document.createElement("style");
    inboxStyle.id="gramora-inbox-inline-style";
    inboxStyle.textContent=`
      .gramora-inbox{box-sizing:border-box;width:100%;max-width:680px;min-height:65vh;margin:0 auto;padding:22px 18px 30px;color:var(--text,#f5f5f7)}
      .gramora-inbox-head{display:block;margin:0 0 22px}
      .gramora-inbox-head .eyebrow{margin:0 0 8px;color:#e879a6;font-size:10px;font-weight:800;letter-spacing:2px}
      .gramora-inbox-head h2{margin:0 0 7px;font-family:Manrope,sans-serif;font-size:29px;line-height:1.2;font-weight:800;letter-spacing:-.7px;color:var(--text,#f5f5f7)}
      .gramora-inbox-subtitle{margin:0;color:var(--muted,#9ca3af);font-size:13px;line-height:1.5}
      .gramora-inbox-search{box-sizing:border-box;display:flex;align-items:center;gap:11px;width:100%;height:48px;margin:0;padding:0 15px;border:1px solid var(--line,#30323b);border-radius:15px;background:var(--surface,#171922);color:var(--muted,#9ca3af)}
      .gramora-inbox-search span{font-size:25px;line-height:1}
      .gramora-inbox-search input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:var(--text,#f5f5f7);font:inherit;font-size:14px}
      .gramora-inbox-search input::placeholder{color:var(--muted,#9ca3af)}
      .gramora-inbox-search input{cursor:text}
      .gramora-inbox-search:focus-within{border-color:#e879a6;box-shadow:0 0 0 3px rgba(232,121,166,.12)}
      .gramora-conversation-list{display:flex;flex-direction:column;gap:8px;margin-top:14px}.gramora-conversation{width:100%;display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--line,#30323b);border-radius:14px;background:var(--surface,#171922);color:var(--text,#f5f5f7);text-align:left;cursor:pointer}.gramora-conversation-avatar{width:48px;height:48px;flex:0 0 48px;display:grid;place-items:center;overflow:hidden;border-radius:50%;background:linear-gradient(135deg,#d85c9a,#8b68dc);color:white;font-weight:800}.gramora-conversation-avatar img{width:100%;height:100%;object-fit:cover}.gramora-conversation-details{display:flex;flex:1;min-width:0;flex-direction:column;gap:5px}.gramora-conversation-details strong,.gramora-conversation-details small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gramora-conversation-details strong{font-size:14px}.gramora-conversation-details small{font-size:12px;color:var(--muted,#9ca3af)}.gramora-conversation.has-unread .gramora-conversation-details small{color:#d946a5!important;font-weight:800}.gramora-conversation-arrow{font-size:26px;color:var(--muted,#9ca3af)}.gramora-conversation[hidden]{display:none}
      
      .gramora-conversation-right{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex:0 0 auto}
      .gramora-inbox-empty{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:42vh;padding:30px 20px;text-align:center}
      .gramora-inbox-empty-icon{box-sizing:border-box;display:grid;place-items:center;width:82px;height:82px;margin-bottom:19px;border:1.5px solid var(--line,#3a3d48);border-radius:50%;background:var(--surface,#171922);font-size:35px;color:#e879a6}
      .gramora-inbox-empty h3{margin:0 0 9px;color:var(--text,#f5f5f7);font-size:17px;font-weight:700}
      .gramora-inbox-empty p{max-width:290px;margin:0;color:var(--muted,#9ca3af);font-size:13px;line-height:1.65}
      body.light .gramora-inbox-search,body.light .gramora-inbox-empty-icon{background:#f3f4f8}
      body.light .gramora-conversation{background:#fff!important;color:#20212a!important;border-color:#e4e6ee!important;box-shadow:0 2px 10px rgba(25,30,50,.045)}
      body.light .gramora-conversation-details strong{color:#20212a!important}
      body.light .gramora-conversation-details small,body.light .gramora-conversation-arrow{color:#73798a!important}
      body.light .gramora-conversation.has-unread .gramora-conversation-details small{color:#d946a5!important;font-weight:800}
      body.light .gramora-conversation:active{background:#f0f1f7!important}
      body.light .gramora-conversation-avatar{color:#fff!important}
      body.light .gramora-inbox-unread{background:#d946a5!important;color:#fff!important}
      @media(max-width:680px){.gramora-inbox{padding:18px 16px 26px}.gramora-inbox-head h2{font-size:27px}.gramora-inbox-empty{min-height:40vh}}
    `;
    document.head.append(inboxStyle);
  }
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
    const search=document.createElement("input");search.type="search";search.placeholder="Search conversations";search.setAttribute("aria-label","Search conversations");
    searchWrap.append(searchIcon,search);page.append(searchWrap);
    const conversationList=document.createElement("div");conversationList.className="gramora-conversation-list";page.append(conversationList);
    const empty=document.createElement("div");empty.className="gramora-inbox-empty";
    const icon=document.createElement("div");icon.className="gramora-inbox-empty-icon";
    icon.innerHTML='<svg viewBox="0 0 48 48" width="42" height="42" fill="none" aria-hidden="true"><path d="M8 11.5A5.5 5.5 0 0 1 13.5 6h21A5.5 5.5 0 0 1 40 11.5v16a5.5 5.5 0 0 1-5.5 5.5H22l-9.5 7v-7.4A5.5 5.5 0 0 1 8 27.5v-16Z" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="m17 19 7 5 7-5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M36.5 3.5v7M33 7h7" stroke="#e879a6" stroke-width="2.4" stroke-linecap="round"/></svg>';
    const emptyTitle=document.createElement("h3");emptyTitle.textContent="Your messages will appear here";
    const emptyText=document.createElement("p");emptyText.textContent="When you message someone, your conversation will appear here.";
    empty.append(icon,emptyTitle,emptyText);page.append(empty);feed.append(page);
    search.addEventListener("input",()=>{
      const query=search.value.trim().toLowerCase();
      const conversations=[...page.querySelectorAll(".gramora-conversation")];
      let visible=0;
      conversations.forEach(item=>{const match=item.textContent.toLowerCase().includes(query);item.hidden=!match;if(match)visible++;});
      if(conversations.length){
        empty.hidden=visible>0;
        if(!visible){emptyTitle.textContent="No conversations found";emptyText.textContent=query?"No chats match this search. Try another name or username.":"Your messages will appear here.";}
      }else{
        empty.hidden=false;
        emptyTitle.textContent=query?"No conversations found":"Your messages will appear here";
        emptyText.textContent=query?"There are no chats to match this search yet.":"When you message someone, your conversation will appear here.";
      }
    });
    return;
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
let gramoraCurrentPage="home";
function openGramoraPage(view){
  if(!view)return;
  if(view==="create"){gramoraCurrentPage="create";openComposer();return;}
  const button=document.querySelector('.mobile-nav [data-view="'+view+'"], .sidebar [data-view="'+view+'"]');
  if(button){button.click();return;}
}
document.querySelectorAll(".nav").forEach(button=>button.addEventListener("click",()=>{
  const view=button.dataset.view;if(!view)return;
  gramoraCurrentPage=view;
  document.body.classList.remove("view-home","view-explore","view-messages","view-saved","view-profile","public-profile-open");
  document.body.classList.add("view-"+view);
  document.body.classList.toggle("profile-active",view==="profile");
  document.querySelectorAll(".nav").forEach(item=>item.classList.toggle("active",item.dataset.view===view));
  const titles={home:"Your feed",explore:"Explore",messages:"Messages",saved:"Saved posts",profile:"My profile"};
  const titleNode=document.getElementById("viewTitle");if(titleNode)titleNode.textContent=titles[view]||"Your feed";
  if(view!=="home"&&view!=="profile"&&view!=="explore")showPlaceholder(view,titles[view]);
  document.dispatchEvent(new CustomEvent("gramora:view",{detail:view}));
  document.body.classList.remove("gm-page-enter");void document.body.offsetWidth;document.body.classList.add("gm-page-enter");
}));
(()=>{
  const surface=document.querySelector(".app-shell")||document.querySelector(".main-content")||document.getElementById("feed");
  if(!surface)return;
  let startX=0,startY=0,startAt=0,tracking=false;
  const blocked=target=>!!target.closest('input,textarea,select,[contenteditable="true"],dialog,.story-viewer,.story-dialog,.post-detail-dialog,.gramora-chat-dialog,.gramora-conversation,.create-photo-stage');
  surface.addEventListener("touchstart",event=>{
    tracking=false;startAt=0;
    if(event.touches.length!==1||blocked(event.target))return;
    const touch=event.touches[0];startX=touch.clientX;startY=touch.clientY;startAt=Date.now();tracking=true;
  },{passive:true,capture:true});
  surface.addEventListener("touchend",event=>{
    if(!tracking||!startAt||!event.changedTouches.length)return;
    const touch=event.changedTouches[0],dx=touch.clientX-startX,dy=touch.clientY-startY,elapsed=Date.now()-startAt;
    tracking=false;startAt=0;
    if(elapsed>900||Math.abs(dx)<55||Math.abs(dx)<Math.abs(dy)*1.25)return;
    const pages=["home","explore","create","messages","profile"],current=pages.indexOf(gramoraCurrentPage);
    if(current<0)return;
    if(dx<0&&current<pages.length-1)openGramoraPage(pages[current+1]);
    else if(dx>0&&current>0)openGramoraPage(pages[current-1]);
  },{passive:true,capture:true});
  surface.addEventListener("touchcancel",()=>{tracking=false;startAt=0;},{passive:true,capture:true});
})();
(()=>{
  const dialog=document.getElementById("createDialog");
  if(!dialog)return;
  let x=0,y=0,started=false;
  dialog.addEventListener("touchstart",event=>{
    started=event.touches.length===1;
    if(!started)return;
    x=event.touches[0].clientX;y=event.touches[0].clientY;
  },{passive:true});
  dialog.addEventListener("touchend",event=>{
    if(!started||!event.changedTouches.length)return;
    started=false;
    const dx=event.changedTouches[0].clientX-x,dy=event.changedTouches[0].clientY-y;
    if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.2){
      if(dialog.open)dialog.close();
      // Match the app's page order: left = next (Inbox), right = previous (Explore).
      openGramoraPage(dx<0?"messages":"explore");
    }
  },{passive:true});
  dialog.addEventListener("touchcancel",()=>{started=false;},{passive:true});
})();
document.addEventListener("DOMContentLoaded",()=>{
  const cleanStrayEscapedNewlines=()=>{
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    const remove=[];
    while(walker.nextNode())if(/^\s*\\n\s*$/.test(walker.currentNode.nodeValue||""))remove.push(walker.currentNode);
    remove.forEach(node=>node.remove());
  };
  cleanStrayEscapedNewlines();
}); 
document.addEventListener("click",event=>{
  const like=event.target.closest(".like");
  if(like){like.classList.toggle("liked");like.innerHTML="<span>"+(like.classList.contains("liked")?"Liked":"Like")+"</span>";}
});