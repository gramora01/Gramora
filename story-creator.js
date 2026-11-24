/* GRAMORA story creator: clear tools, separate text entry, drag text and pinch photo */
(() => {
  const $ = id => document.getElementById(id);
  const dlg=$("storyCreateDialog"),form=$("storyForm"),ta=$("storyText");
  if(!dlg||!form||!ta||form.dataset.gseInitialized==="1")return;
  form.dataset.gseInitialized="1";
  const stage=$("storyPreviewCanvas");
  const S=p=>'<svg viewBox="0 0 24 24" aria-hidden="true">'+p+"</svg>";
  const icons={
    text:"<b>Aa</b>",
    image:S('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>'),
    music:S('<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2.5"/><circle cx="17" cy="16" r="2.5"/>'),
    effects:S('<path d="M4 4h16v16H4z"/><path d="m4 15 5-5 4 4 3-3 4 4"/><circle cx="9" cy="8" r="1.5"/>'),
    align:S('<path d="M4 7h16M4 12h10M4 17h16"/>'),
    send:S('<path d="M5 12h14M13 6l6 6-6 6"/>')
  };
  const el=(tag,cls,html)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(html)n.innerHTML=html;return n;};
  const click=id=>$(id)?.click();
  const tool=(label,icon,fn)=>{const b=el("button","gse-tool","<span>"+label+"</span><em class=\"gse-c\">"+icon+"</em>");b.type="button";b.addEventListener("click",fn);return b;};
  const host=$("storyEditorWorkspace")||form;
  const tools=el("div","gse-tools");
  const revealText=()=>{
    ta.hidden=false;
    ta.focus();
    dlg.classList.add("gse-editing");
    if(!ta.value)ta.setAttribute("aria-label","Write your story text");
  };
  tools.append(
    tool("Text",icons.text,revealText),
    tool("Add image",icons.image,()=>click("storyImageFile")),
    tool("Song",icons.music,()=>click("openStoryMusic")),
    tool("Effects",icons.effects,()=>cycleImageEffect()),
    tool("Align",icons.align,()=>click("storyTextAlignToggle"))
  );
  const imageEffects=[{name:"Normal",filter:"none"},{name:"Warm",filter:"sepia(.28) saturate(1.2)"},{name:"Vintage",filter:"sepia(.48) contrast(.92) brightness(1.04)"},{name:"B&W",filter:"grayscale(1)"},{name:"Cool",filter:"saturate(1.12) hue-rotate(12deg)"},{name:"Vivid",filter:"saturate(1.55) contrast(1.08)"}];
  const effectInput=(()=>{let x=$("storyImageEffect");if(!x){x=document.createElement("input");x.type="hidden";x.id="storyImageEffect";x.value="0";form.append(x);}return x;})();
  let effectIndex=0;
  const applyImageEffect=()=>{const filter=imageEffects[effectIndex].filter;const img=$("storyImagePreview");if(img)img.style.filter=filter==="none"?"":filter;const b=tools.querySelectorAll(".gse-tool")[2];if(b){b.setAttribute("aria-label","Effects: "+imageEffects[effectIndex].name+". Tap to change");b.title=imageEffects[effectIndex].name;}effectInput.value=String(effectIndex);};
  function cycleImageEffect(){effectIndex=(effectIndex+1)%imageEffects.length;applyImageEffect();}
  window.gramoraApplyStoryEffect=(index)=>{effectIndex=Math.max(0,Math.min(imageEffects.length-1,Number(index)||0));applyImageEffect();};
  (stage||host).append(tools);
  const bottom=el("div","gse-bottom");
  const pill=el("button","gse-pill",'<i class="gse-av">G</i>Your story');pill.type="button";
  const send=el("button","gse-send",icons.send);send.type="button";send.setAttribute("aria-label","Share story");send.addEventListener("click",()=>click("storyShareSubmit"));
  bottom.append(pill,el("span","gse-sp"),send);host.append(bottom);
  const cancel=$("closeStoryCreate");if(cancel){cancel.textContent="×";cancel.setAttribute("aria-label","Close story creator");}
  const oldMove=$("storyMoveText");if(oldMove)oldMove.hidden=true;
  const oldPick=$("storyImagePickButton");if(oldPick)oldPick.hidden=true;
  const oldRemove=$("storyImageRemove");if(oldRemove)oldRemove.hidden=true;
  const done=$("storyEditorDone");if(done)done.addEventListener("click",()=>{ta.blur();dlg.classList.remove("gse-editing");});
  ta.addEventListener("input",()=>{ta.hidden=!ta.value.trim()&&document.activeElement!==ta;});
  ta.addEventListener("blur",()=>{if(!ta.value.trim())ta.hidden=true;dlg.classList.remove("gse-editing");});
  const bgSync=()=>{const v=$("storyBackground")?.value;if(v&&stage)stage.style.background=v;};
  $("storyBackgroundPicker")?.addEventListener("click",()=>setTimeout(bgSync,0));
  new MutationObserver(()=>{if(dlg.open)bgSync();}).observe(dlg,{attributes:true,attributeFilter:["open"]});
  bgSync();

  // A text overlay can be grabbed and repositioned directly after typing; no move-mode button.
  let dragId=null;
  ta.addEventListener("pointerdown",e=>{
    if(!ta.value.trim()||document.activeElement===ta||e.pointerType==="mouse")return;
    dragId=e.pointerId;ta.setPointerCapture(e.pointerId);e.preventDefault();
  });
  ta.addEventListener("pointermove",e=>{
    if(dragId!==e.pointerId||!stage)return;
    const r=stage.getBoundingClientRect(),x=Math.max(6,Math.min(94,(e.clientX-r.left)/r.width*100)),y=Math.max(6,Math.min(94,(e.clientY-r.top)/r.height*100));
    $("storyTextX").value=String(x);$("storyTextY").value=String(y);
    ta.style.position="absolute";ta.style.left=x+"%";ta.style.top=y+"%";ta.style.transform="translate(-50%,-50%)";ta.style.width="82%";
  });
  const endDrag=e=>{if(dragId===e.pointerId)dragId=null;};
  ta.addEventListener("pointerup",endDrag);ta.addEventListener("pointercancel",endDrag);

  // Two-finger pinch gesture controls photo scale (1x to 3x).
  const photo=$("storyImagePreview"),scaleInput=(()=>{let x=$("storyImageScale");if(!x){x=document.createElement("input");x.type="hidden";x.id="storyImageScale";x.value="1";form.append(x);}return x;})();
  let points=new Map(),pinchStart=0,scaleStart=1;
  const distance=()=>{const p=[...points.values()];return p.length<2?0:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);};
  stage?.addEventListener("pointerdown",e=>{
    if(!photo||photo.hidden||e.pointerType!=="touch")return;
    points.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(points.size===2){pinchStart=distance();scaleStart=Number(scaleInput.value)||1;}
  });
  stage?.addEventListener("pointermove",e=>{
    if(!points.has(e.pointerId)||points.size<2)return;
    points.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const d=distance();if(!pinchStart||!d)return;
    const scale=Math.max(1,Math.min(3,scaleStart*d/pinchStart));
    scaleInput.value=String(scale);stage.style.setProperty("--story-image-scale",String(scale));
  });
  const clearPoint=e=>{points.delete(e.pointerId);if(points.size<2)pinchStart=0;};
  stage?.addEventListener("pointerup",clearPoint);stage?.addEventListener("pointercancel",clearPoint);
  const imageFile=$("storyImageFile");
  imageFile?.addEventListener("change",()=>{if(imageFile.files?.length){scaleInput.value="1";stage?.style.setProperty("--story-image-scale","1");effectIndex=0;applyImageEffect();}});
  $("storyImageRemove")?.addEventListener("click",()=>{scaleInput.value="1";stage?.style.setProperty("--story-image-scale","1");});
  const reset=()=>{ta.value="";ta.hidden=true;scaleInput.value="1";effectIndex=0;applyImageEffect();stage?.style.setProperty("--story-image-scale","1");ta.style.position="";ta.style.left="";ta.style.top="";ta.style.transform="";};
  form.addEventListener("reset",()=>setTimeout(reset,0));
  dlg.addEventListener("close",reset);
  const vv=window.visualViewport,upd=()=>dlg.style.setProperty("--vvh",(vv?vv.height:innerHeight)+"px");
  vv?.addEventListener("resize",upd);upd();
})();