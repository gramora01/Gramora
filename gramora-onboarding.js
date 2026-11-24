/* GRAMORA first-visit welcome guide */
(()=>{
  const steps=[
    {icon:"◎",eyebrow:"01 · YOUR COMMUNITY",title:"Stories se shuru karein",copy:"Stories row mein apni story share karein aur doosre logon ki stories dekhein. Kisi story par tap karke use open karein."},
    {icon:"⌂",eyebrow:"02 · YOUR FEED",title:"Posts dekhein aur connect karein",copy:"Home feed mein community ki photos aur text posts milengi. Like, comment, save aur repost ke options post ke saath milte hain."},
    {icon:"✦",eyebrow:"03 · DISCOVER",title:"Naye logon ko explore karein",copy:"Explore mein naye creators aur posts discover karein. Kisi profile par jaakar unki posts aur details dekhein."},
    {icon:"＋",eyebrow:"04 · CREATE & CHAT",title:"Apni baat share karein",copy:"Create button se photo ya text post banayein. Messages se doosre users ke saath conversation shuru karein."}
  ];
  let current=0,dialog=null;
  const finish=()=>{try{localStorage.setItem("gramora-welcome-tour-v1","done")}catch(e){};dialog?.close()};
  function render(){
    if(!dialog)return;
    const step=steps[current];
    dialog.querySelector(".gm-tour-icon").textContent=step.icon;
    dialog.querySelector(".gm-tour-eyebrow").textContent=step.eyebrow;
    dialog.querySelector(".gm-tour-title").textContent=step.title;
    dialog.querySelector(".gm-tour-copy").textContent=step.copy;
    dialog.querySelector(".gm-tour-next").textContent=current===steps.length-1?"Start exploring":"Next →";
    dialog.querySelector(".gm-tour-dots").replaceChildren(...steps.map((_,i)=>{const dot=document.createElement("span");dot.className="gm-tour-dot"+(i===current?" active":"");return dot}));
  }
  function openGuide(){
    if(!dialog){
      dialog=document.createElement("dialog");dialog.className="gm-tour-dialog";dialog.setAttribute("aria-labelledby","gmTourTitle");
      dialog.innerHTML='<div class="gm-tour-top"><div class="gm-tour-brand"><span class="gm-tour-mark">g.</span> GRAMORA</div><button class="gm-tour-skip" type="button">Skip guide</button></div><div class="gm-tour-body"><div class="gm-tour-icon" aria-hidden="true"></div><p class="gm-tour-eyebrow"></p><h2 class="gm-tour-title" id="gmTourTitle"></h2><p class="gm-tour-copy"></p><div class="gm-tour-dots" aria-hidden="true"></div><div class="gm-tour-actions"><button class="gm-tour-secondary" type="button">Not now</button><button class="gm-tour-next" type="button">Next →</button></div></div>';
      document.body.append(dialog);
      dialog.querySelector(".gm-tour-skip").addEventListener("click",finish);
      dialog.querySelector(".gm-tour-secondary").addEventListener("click",()=>dialog.close());
      dialog.querySelector(".gm-tour-next").addEventListener("click",()=>{if(current===steps.length-1){finish();return}current++;render()});
      dialog.addEventListener("click",e=>{if(e.target===dialog)dialog.close()});
      dialog.addEventListener("close",()=>{current=0});
    }
    current=0;render();if(!dialog.open)dialog.showModal();
  }
  const help=document.createElement("button");help.type="button";help.className="gm-help-button";help.textContent="?";help.setAttribute("aria-label","Open GRAMORA guide");help.title="How to use GRAMORA";help.addEventListener("click",openGuide);document.body.append(help);
  let shown=false;
  const check=()=>{
    const gate=document.getElementById("authGate");
    const ready=gate&&gate.hidden&&!document.body.classList.contains("auth-pending")&&!document.body.classList.contains("auth-required");
    if(!shown&&ready){shown=true;let done=false;try{done=localStorage.getItem("gramora-welcome-tour-v1")==="done"}catch(e){};if(!done)window.setTimeout(openGuide,650)}
  };
  const observer=new MutationObserver(check);observer.observe(document.body,{attributes:true,attributeFilter:["class"],childList:true,subtree:true});
  document.addEventListener("DOMContentLoaded",check);window.addEventListener("load",check);check();
})();
