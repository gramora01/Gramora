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
    effects:S('<path d="M12 3.5 14 9l5.5 2-5.5 2-2 5.5-2-5.5-5.5-2L10 9l2-5.5Z"/><path d="m19 3 .7 2.3L22 6l-2.3.7L19 9l-.7-2.3L16 6l2.3-.7L19 3Z"/><path d="m5 15 .7 2.3L8 18l-2.3.7L5 21l-.7-2.3L2 18l2.3-.7L5 15Z"/>'),
    align:S('<path d="M4 7h16M4 12h10M4 17h16"/>'),
    color:S('<path d="M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 1.5-3.3 1.7 1.7 0 0 1 1.3-2.8H18a3 3 0 0 0 3-3c0-5-4-9-9-9Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="15" cy="8" r="1"/>'),
    send:S('<path d="M5 12h14M13 6l6 6-6 6"/>')
  };
  const el=(tag,cls,html)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(html)n.innerHTML=html;return n;};
  const click=id=>$(id)?.click();
  const tool=(label,icon,fn)=>{const b=el("button","gse-tool","<span>"+label+"</span><em class=\"gse-c\">"+icon+"</em>");b.type="button";b.addEventListener("click",fn);return b;};
  const host=$("storyEditorWorkspace")||form;
  const tools=el("div","gse-tools");
  const revealText=(x,y)=>{
    if(typeof x==="number"&&stage){
      const r=stage.getBoundingClientRect(),px=Math.max(8,Math.min(92,(x-r.left)/r.width*100)),py=Math.max(8,Math.min(92,(y-r.top)/r.height*100));
      $("storyTextX").value=String(px);$("storyTextY").value=String(py);
      ta.style.position="absolute";ta.style.left=px+"%";ta.style.top=py+"%";ta.style.transform="translate(-50%,-50%)";ta.style.width="82%";
    }
    ta.hidden=false;ta.style.pointerEvents="auto";dlg.classList.add("gse-editing");
    if(!ta.value)ta.setAttribute("aria-label","Write your story text");ta.focus();
  };
  tools.append(
    tool("Text",icons.text,revealText),
    tool("Add image",icons.image,()=>click("storyImageFile")),
    tool("Song",icons.music,()=>click("openStoryMusic")),
    tool("Effects",icons.effects,()=>cycleImageEffect()),
    tool("Align",icons.align,()=>click("storyTextAlignToggle")),
    tool("Color",icons.color,()=>toggleTextColors())
  );
  const imageEffects=[{name:"Normal",filter:"none"},{name:"Warm",filter:"sepia(.28) saturate(1.2)"},{name:"Vintage",filter:"sepia(.48) contrast(.92) brightness(1.04)"},{name:"B&W",filter:"grayscale(1)"},{name:"Cool",filter:"saturate(1.12) hue-rotate(12deg)"},{name:"Vivid",filter:"saturate(1.55) contrast(1.08)"}];
  const effectInput=(()=>{let x=$("storyImageEffect");if(!x){x=document.createElement("input");x.type="hidden";x.id="storyImageEffect";x.value="0";form.append(x);}return x;})();
  let effectIndex=0;
  const applyImageEffect=()=>{const filter=imageEffects[effectIndex].filter;const img=$("storyImagePreview");if(img)img.style.filter=filter==="none"?"":filter;const b=tools.querySelectorAll(".gse-tool")[3];if(b){b.setAttribute("aria-label","Effects: "+imageEffects[effectIndex].name+". Tap to change");b.title=imageEffects[effectIndex].name;}effectInput.value=String(effectIndex);};
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
  const done=$("storyEditorDone");if(done)done.addEventListener("click",()=>{ta.blur();ta.style.pointerEvents=ta.value.trim()?"auto":"none";dlg.classList.remove("gse-editing");});
  ta.addEventListener("input",()=>{ta.hidden=!ta.value.trim()&&document.activeElement!==ta;});
  ta.addEventListener("blur",()=>{if(!ta.value.trim())ta.hidden=true;ta.style.pointerEvents=ta.value.trim()?"auto":"none";dlg.classList.remove("gse-editing");});
  const bgSync=()=>{const v=$("storyBackground")?.value;if(v&&stage)stage.style.background=v;};
  $("storyBackgroundPicker")?.addEventListener("click",()=>setTimeout(bgSync,0));
  new MutationObserver(()=>{if(dlg.open)bgSync();}).observe(dlg,{attributes:true,attributeFilter:["open"]});
  bgSync();

  // Instagram-style text colour palette.
  const textColors=["#ffffff","#111111","#ff3040","#ff7a00","#ffd60a","#34c759","#00c7be","#0a84ff","#5e5ce6","#bf5af2","#ff2d55","#ff9fba"];
  const colorInput=(()=>{let x=$("storyTextColor");if(!x){x=document.createElement("input");x.type="hidden";x.id="storyTextColor";x.value="#ffffff";form.append(x);}return x;})();
  const palette=el("div","gse-color-palette");
  textColors.forEach(color=>{const b=el("button","gse-color-swatch");b.type="button";b.style.background=color;b.setAttribute("aria-label","Text colour "+color);b.addEventListener("click",()=>{ta.style.setProperty("color",color,"important");colorInput.value=color;palette.classList.remove("is-open");});palette.append(b);});
  stage?.append(palette);
  function toggleTextColors(){palette.classList.toggle("is-open");}
  window.gramoraApplyStoryTextColor=color=>{if(!color)return;ta.style.setProperty("color",color,"important");colorInput.value=color;};

  // One-finger photo pan, two-finger pinch zoom, tap-anywhere text entry and text dragging.
  const photo=$("storyImagePreview");
  const scaleInput=(()=>{let x=$("storyImageScale");if(!x){x=document.createElement("input");x.type="hidden";x.id="storyImageScale";x.value="1";form.append(x);}return x;})();
  const xInput=(()=>{let x=$("storyImageX");if(!x){x=document.createElement("input");x.type="hidden";x.id="storyImageX";x.value="0";form.append(x);}return x;})();
  const yInput=(()=>{let x=$("storyImageY");if(!x){x=document.createElement("input");x.type="hidden";x.id="storyImageY";x.value="0";form.append(x);}return x;})();
  let imageX=0,imageY=0,scale=1,points=new Map(),gesture=null,pinchStart=0,pinchScale=1;
  const applyPhotoTransform=()=>{stage?.style.setProperty("--story-image-scale",String(scale));stage?.style.setProperty("--story-image-x",imageX+"px");stage?.style.setProperty("--story-image-y",imageY+"px");scaleInput.value=String(scale);xInput.value=String(imageX);yInput.value=String(imageY);};
  const distance=()=>{const p=[...points.values()];return p.length<2?0:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);};
  const isTool=e=>!!e.target.closest(".gse-tools,.gse-bottom,.gse-color-palette,button");
  stage?.addEventListener("pointerdown",e=>{
    if(isTool(e)||e.pointerType==="mouse"&&e.button!==0)return;
    if(e.target===ta&&document.activeElement===ta)return;
    stage.setPointerCapture?.(e.pointerId);points.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(points.size===2){gesture={kind:"pinch",moved:true};pinchStart=distance();pinchScale=scale;return;}
    if(e.target===ta&&ta.value.trim())gesture={kind:"text",id:e.pointerId,x:e.clientX,y:e.clientY,moved:false};
    else if(photo&&!photo.hidden)gesture={kind:"photo",id:e.pointerId,x:e.clientX,y:e.clientY,startX:imageX,startY:imageY,moved:false};
    else gesture={kind:"place",id:e.pointerId,x:e.clientX,y:e.clientY,moved:false};
  });
  stage?.addEventListener("pointermove",e=>{
    if(!points.has(e.pointerId))return;points.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(points.size>=2&&gesture?.kind==="pinch"){const d=distance();if(pinchStart&&d){scale=Math.max(1,Math.min(3,pinchScale*d/pinchStart));applyPhotoTransform();}return;}
    if(!gesture||gesture.id!==e.pointerId)return;
    const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;if(Math.hypot(dx,dy)>5)gesture.moved=true;if(!gesture.moved)return;
    if(gesture.kind==="photo"){imageX=gesture.startX+dx;imageY=gesture.startY+dy;applyPhotoTransform();}
    else if(gesture.kind==="text"){const r=stage.getBoundingClientRect(),px=Math.max(5,Math.min(95,(e.clientX-r.left)/r.width*100)),py=Math.max(5,Math.min(95,(e.clientY-r.top)/r.height*100));$("storyTextX").value=String(px);$("storyTextY").value=String(py);ta.style.position="absolute";ta.style.left=px+"%";ta.style.top=py+"%";ta.style.transform="translate(-50%,-50%)";ta.style.width="82%";e.preventDefault();}
  });
  const finishGesture=e=>{
    if(!points.has(e.pointerId))return;const g=gesture;points.delete(e.pointerId);
    if(points.size<2){gesture=null;pinchStart=0;}
    if(!g||g.id!==e.pointerId||g.moved)return;
    if(g.kind==="place")revealText(e.clientX,e.clientY);else if(g.kind==="text")revealText();
  };
  stage?.addEventListener("pointerup",finishGesture);
  stage?.addEventListener("pointercancel",e=>{points.delete(e.pointerId);gesture=null;pinchStart=0;});
  applyPhotoTransform();
  const imageFile=$("storyImageFile");
  imageFile?.addEventListener("change",()=>{if(imageFile.files?.length){scale=1;imageX=0;imageY=0;applyPhotoTransform();effectIndex=0;applyImageEffect();}});
  $("storyImageRemove")?.addEventListener("click",()=>{scaleInput.value="1";stage?.style.setProperty("--story-image-scale","1");});
  const reset=()=>{ta.value="";ta.hidden=true;ta.style.pointerEvents="none";scale=1;imageX=0;imageY=0;applyPhotoTransform();effectIndex=0;applyImageEffect();ta.style.position="";ta.style.left="";ta.style.top="";ta.style.transform="";colorInput.value="#ffffff";ta.style.color="#ffffff";palette.classList.remove("is-open");};
  form.addEventListener("reset",()=>setTimeout(reset,0));
  dlg.addEventListener("close",reset);
  const vv=window.visualViewport,upd=()=>dlg.style.setProperty("--vvh",(vv?vv.height:innerHeight)+"px");
  vv?.addEventListener("resize",upd);upd();
})();