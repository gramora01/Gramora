/* ===== GRAMORA story actions + chat composer integration ===== */
(()=>{
  if(window.__gramoraStoryChatActions)return;
  window.__gramoraStoryChatActions=true;
  const $=id=>document.getElementById(id);
  const svg=(path)=>'<svg viewBox="0 0 24 24" aria-hidden="true">'+path+'</svg>';
  const icons={
    activity:svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 3-5.5 6.5-5.5s6.5 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.6 0 4.5 1.4 4.5 4"/>'),
    share:svg('<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.3 10.8l7.4-3.6M8.3 13.2l7.4 3.6"/>'),
    facebook:svg('<circle cx="12" cy="12" r="10.5" fill="#1877f2" stroke="none"/><path fill="#fff" stroke="none" d="M13.2 19.5v-6.6h2.2l.4-2.7h-2.6V8.5c0-.8.3-1.3 1.4-1.3h1.3V4.8c-.3 0-1-.1-2-.1-2 0-3.4 1.2-3.4 3.5v2H8.3v2.7h2.2v6.6z"/>'),
    highlight:svg('<circle cx="12" cy="12" r="10" stroke-dasharray="3 2.5"/><path d="M12 16.5l-3.8-3.7a2.4 2.4 0 0 1 3.8-2.8 2.4 2.4 0 0 1 3.8 2.8z"/>'),
    more:svg('<g fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></g>'),
    chat:svg('<path d="M21 12a8.5 8.5 0 0 1-12.3 7.6L3 21l1.5-5.4A8.5 8.5 0 1 1 21 12z"/>'),
    send:svg('<path d="M21.5 3L10 14M21.5 3l-7 18-3.5-7-7-3.5z"/>'),
    plus:svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>')
  };
  function notify(message){
    const host=$("storyViewerDialog")?.open?$("storyViewerDialog"):document.body;
    const node=document.createElement("div");node.className="gv-toast";node.textContent=message;host.append(node);
    setTimeout(()=>node.remove(),2200);
  }
  function makeButton(icon,label,cls,handler){
    const b=document.createElement("button");b.type="button";b.className=cls;b.innerHTML=icon+(label?'<span>'+label+'</span>':"");b.addEventListener("click",handler);return b;
  }
  function buildStory(dialog){
    const bottom=dialog.querySelector(".gramora-viewer-bottom");
    if(!bottom||bottom.dataset.gvActions)return;
    bottom.dataset.gvActions="1";
    const trigger=id=>{const target=$(id);if(!target||target.hidden){notify("This action is not available");return;}target.click();};
    const actionBar=document.createElement("div");actionBar.className="gv-owner-bar";
    const menu=document.createElement("div");menu.className="gv-menu";menu.hidden=true;
    [["Edit story",()=>trigger("storyViewerEdit")],["Delete story",()=>trigger("storyViewerDelete")],["Cancel",()=>{}]].forEach(([label,fn])=>{
      const item=document.createElement("button");item.type="button";item.textContent=label;
      item.addEventListener("click",()=>{menu.hidden=true;fn();});menu.append(item);
    });
    dialog.append(menu);
    actionBar.append(
      makeButton(icons.activity,"Activity","gv-btn",()=>trigger("storyViewerViewToggle")),
      makeButton(icons.share,"Share to","gv-btn",async()=>{
        const storyText=$("storyViewerText")?.textContent||"My GRAMORA story",url=location.href.split("#")[0];
        try{if(navigator.share)await navigator.share({title:"GRAMORA story",text:storyText,url});else if(navigator.clipboard){await navigator.clipboard.writeText(storyText+" "+url);notify("Story link copied");}else notify("Sharing is not supported on this browser");}catch(e){if(e?.name!=="AbortError")notify("Could not share this story");}
      }),
      makeButton(icons.facebook,"Facebook","gv-btn",()=>window.open("https://www.facebook.com/sharer/sharer.php?u="+encodeURIComponent(location.href.split("#")[0]),"_blank","noopener,noreferrer")),
      makeButton(icons.highlight,"Highlight","gv-btn",()=>{
        const user=window.gramoraOpenHighlightCreator?true:false;
        if(typeof window.gramoraOpenHighlightCreator==="function"){dialog.close();window.gramoraOpenHighlightCreator();}
        else notify("Highlight creator is unavailable");
      }),
      makeButton(icons.more,"More","gv-btn",()=>{menu.hidden=!menu.hidden;})
    );
    bottom.prepend(actionBar);
    const row=bottom.querySelector(".gramora-viewer-reply-row"),input=$("storyReplyInput"),form=$("storyReplyForm");
    if(input)input.placeholder="Send message";
    if(row){
      row.append(
        makeButton(icons.chat,"","gv-ico",()=>input?.focus()),
        makeButton(icons.send,"","gv-ico",()=>{if(input?.value.trim()&&form)form.requestSubmit();else input?.focus();})
      );
    }
  }
  function syncStory(dialog){
    const ownerSection=$("storyViewerViews");
    dialog.classList.toggle("gv-owner",!!ownerSection&&!ownerSection.hidden);
    const menu=dialog.querySelector(".gv-menu");if(menu&&!dialog.open&&!menu.hidden)menu.hidden=true;
  }
  function buildChat(form){
    if(form.dataset.gvActions)return;form.dataset.gvActions="1";
    const input=form.querySelector("input"),sticker=form.querySelector(".gramora-chat-sticker-toggle"),submit=form.querySelector('button[type="submit"]');
    if(sticker){sticker.innerHTML=svg('<path d="M20 12a8 8 0 1 0-8 8c4.4 0 8-3.6 8-8zM20 12h-4a4 4 0 0 0-4 4v4"/><circle cx="9" cy="10" r=".8"/><circle cx="15" cy="10" r=".8"/>');sticker.classList.add("gc-ico","gc-hide");}
    if(submit){submit.textContent="Send";submit.classList.add("gc-send");}
    if(input)input.placeholder="Message…";
    const more=makeButton(icons.plus,"","gc-ico gc-hide",()=>{if(sticker)sticker.click();else notify("Stickers are not available in this chat");});
    if(submit)form.insertBefore(more,submit);else form.append(more);
    const sync=()=>form.classList.toggle("gc-typing",!!input?.value.trim());
    ["input","keyup","change"].forEach(type=>input?.addEventListener(type,sync));
    form.addEventListener("submit",()=>setTimeout(sync,100));
    sync();
  }
  function scan(){
    const dialog=$("storyViewerDialog");if(dialog){buildStory(dialog);syncStory(dialog);}
    document.querySelectorAll(".gramora-chat-compose").forEach(buildChat);
  }
  const observer=new MutationObserver(scan);
  if(document.body)observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["hidden","open","data-story-id"]});
  scan();
})();

window.gramoraOpenHighlightCreator=()=>openHighlightCreator(auth.currentUser);
