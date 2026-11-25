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
      stage.style.setProperty("--story-text-x",px+"%");stage.style.setProperty("--story-text-y",py+"%");ta.style.position="absolute";ta.style.left=px+"%";ta.style.top=py+"%";ta.style.transform="translate(-50%,-50%)";ta.style.width="82%";
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
  const done=$("storyEditorDone");if(done)done.addEventListener("click",()=>{ta.blur();ta.style.pointerEvents="none";dlg.classList.remove("gse-editing");});
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
  // Direct font preset handling, independent of legacy auth.js listeners.
  const fontPresets={classic:"650 32px Arial,sans-serif",modern:"700 32px system-ui,sans-serif",elegant:"italic 500 32px Georgia,serif",strong:"800 32px Impact,sans-serif"};
  dlg.querySelector(".gramora-story-style-strip")?.addEventListener("click",e=>{
    const button=e.target.closest("[data-story-font]");
    if(!button)return;
    ta.style.setProperty("font",fontPresets[button.dataset.storyFont]||fontPresets.classic,"important");
    dlg.querySelectorAll(".gramora-story-style-strip [data-story-font]").forEach(item=>item.classList.toggle("active",item===button));
  });
  function toggleTextColors(){palette.classList.toggle("is-open");}
  window.gramoraApplyStoryTextColor=color=>{if(!color)return;ta.style.setProperty("color",color,"important");colorInput.value=color;};

  // Unified Instagram-like gestures: photo pan/pinch and text drag/pinch-size.
  const photo=$("storyImagePreview");
  const scaleInput=(()=>{let x=$("storyImageScale");if(!x){x=document.createElement("input");x.type="hidden";x.id="storyImageScale";x.value="1";form.append(x);}return x;})();
  const xInput=(()=>{let x=$("storyImageX");if(!x){x=document.createElement("input");x.type="hidden";x.id="storyImageX";x.value="0";form.append(x);}return x;})();
  const yInput=(()=>{let x=$("storyImageY");if(!x){x=document.createElement("input");x.type="hidden";x.id="storyImageY";x.value="0";form.append(x);}return x;})();
  const textSizeInput=(()=>{let x=$("storyTextSize");if(!x){x=document.createElement("input");x.type="hidden";x.id="storyTextSize";x.value="34";form.append(x);}return x;})();
  let imageX=0,imageY=0,scale=1,textSize=34,pointers=new Map(),gesture=null,pinchDistance=0,pinchScale=1,pinchTextSize=34,pinchCenter=null,lastTapAt=0;
  const applyPhotoTransform=()=>{
    if(photo){photo.style.position="absolute";photo.style.left="50%";photo.style.top="50%";photo.style.right="auto";photo.style.bottom="auto";photo.style.width="100%";photo.style.height="100%";photo.style.objectFit="cover";photo.style.transform="translate(calc(-50% + "+imageX+"px),calc(-50% + "+imageY+"px)) scale("+scale+")";photo.style.transformOrigin="center center";photo.style.willChange="transform";}
    scaleInput.value=String(scale);xInput.value=String(imageX);yInput.value=String(imageY);
    stage?.style.setProperty("--story-image-scale",String(scale));stage?.style.setProperty("--story-image-x",imageX+"px");stage?.style.setProperty("--story-image-y",imageY+"px");
  };
  const applyTextSize=v=>{textSize=Math.max(12,Math.min(88,Number(v)||34));ta.style.setProperty("font-size",textSize+"px","important");textSizeInput.value=String(textSize);if(textSizeRange)textSizeRange.value=String(textSize);};
  const distance=()=>{const p=[...pointers.values()];return p.length<2?0:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);};
  const center=()=>{const p=[...pointers.values()];return p.length<2?null:{x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2};};
  const isControl=e=>!!e.target.closest(".gse-tools,.gse-bottom,.gse-color-palette,.gse-zoom-control,.gse-text-size-control,button,.gramora-story-style-strip,input");
  const textHit=(x,y)=>{if(!ta.value.trim()||ta.hidden)return false;const r=ta.getBoundingClientRect();return x>=r.left-16&&x<=r.right+16&&y>=r.top-16&&y<=r.bottom+16;};
  const moveTextTo=(x,y)=>{const r=stage.getBoundingClientRect();if(!r.width||!r.height)return;const px=Math.max(4,Math.min(96,(x-r.left)/r.width*100)),py=Math.max(5,Math.min(95,(y-r.top)/r.height*100));stage.style.setProperty("--story-text-x",px+"%");stage.style.setProperty("--story-text-y",py+"%");ta.style.position="absolute";ta.style.inset="auto";ta.style.left=px+"%";ta.style.top=py+"%";ta.style.transform="translate(-50%,-50%)";ta.style.width="82%";$("storyTextX").value=String(px);$("storyTextY").value=String(py);};
  const showTextAt=(x,y)=>{if(typeof x==="number")moveTextTo(x,y);ta.hidden=false;ta.style.pointerEvents="none";dlg.classList.add("gse-editing");if(!ta.value)ta.setAttribute("aria-label","Write your story text");try{ta.focus({preventScroll:true});}catch(_){ta.focus();}};
  const pointDown=e=>{
    if(isControl(e)||(e.pointerType==="mouse"&&e.button!==0))return;
    const onText=textHit(e.clientX,e.clientY);
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,onText});
    try{stage.setPointerCapture(e.pointerId);}catch(_){}
    if(pointers.size===2){
      const pts=[...pointers.values()],bothText=pts.every(p=>p.onText);
      gesture={kind:bothText?"text-pinch":"photo-pinch",moved:true};
      pinchDistance=distance();pinchCenter=center();pinchScale=scale;pinchTextSize=textSize;
      e.preventDefault();return;
    }
    gesture={kind:onText?"text":"photo",id:e.pointerId,x:e.clientX,y:e.clientY,startX:onText?(parseFloat(ta.style.left)||50):imageX,startY:onText?(parseFloat(ta.style.top)||50):imageY,moved:false};
    if(onText)e.preventDefault();
  };
  const pointMove=e=>{
    if(!pointers.has(e.pointerId))return;
    const p=pointers.get(e.pointerId);pointers.set(e.pointerId,{...p,x:e.clientX,y:e.clientY});
    if(pointers.size>1&&gesture){
      const d=distance(),c=center();
      if(gesture.kind==="photo-pinch"){
        if(pinchDistance&&d){scale=Math.max(1,Math.min(4,pinchScale*d/pinchDistance));}
        if(c&&pinchCenter){imageX+=c.x-pinchCenter.x;imageY+=c.y-pinchCenter.y;pinchCenter=c;}
        applyPhotoTransform();
      }else if(gesture.kind==="text-pinch"&&pinchDistance&&d){applyTextSize(pinchTextSize*d/pinchDistance);}
      e.preventDefault();return;
    }
    if(!gesture||gesture.id!==e.pointerId)return;
    const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;
    if(Math.hypot(dx,dy)>3)gesture.moved=true;
    if(!gesture.moved)return;
    if(gesture.kind==="photo"){imageX=gesture.startX+dx;imageY=gesture.startY+dy;applyPhotoTransform();}
    else moveTextTo(e.clientX,e.clientY);
    e.preventDefault();
  };
  const pointUp=e=>{if(!pointers.has(e.pointerId))return;const g=gesture;pointers.delete(e.pointerId);if(pointers.size<2){gesture=null;pinchDistance=0;pinchCenter=null;}if(!g||g.id!==e.pointerId||g.moved)return;if(g.kind==="photo"){lastTapAt=Date.now();showTextAt(e.clientX,e.clientY);}};
  if(stage){stage.style.touchAction="none";stage.addEventListener("pointerdown",pointDown,{passive:false});stage.addEventListener("pointermove",pointMove,{passive:false});stage.addEventListener("pointerup",pointUp);stage.addEventListener("pointercancel",e=>{pointers.delete(e.pointerId);gesture=null;pinchDistance=0;pinchCenter=null;});stage.addEventListener("lostpointercapture",e=>{pointers.delete(e.pointerId);if(!pointers.size)gesture=null;});stage.addEventListener("click",e=>{if(isControl(e)||Date.now()-lastTapAt<500||!photo||photo.hidden)return;showTextAt(e.clientX,e.clientY);});}
  const zoom=el("div","gse-zoom-control"),zoomOut=el("button","gse-zoom-button","−"),zoomRange=el("input","gse-zoom-range"),zoomIn=el("button","gse-zoom-button","+"),resetView=el("button","gse-zoom-reset","Reset");
  zoomOut.type="button";zoomOut.setAttribute("aria-label","Zoom out");zoomRange.type="range";zoomRange.min="1";zoomRange.max="4";zoomRange.step=".05";zoomRange.value=String(scale);zoomRange.setAttribute("aria-label","Photo zoom");zoomIn.type="button";zoomIn.setAttribute("aria-label","Zoom in");resetView.type="button";
  const setZoom=v=>{scale=Math.max(1,Math.min(4,Number(v)||1));zoomRange.value=String(scale);applyPhotoTransform();};
  zoomOut.addEventListener("click",()=>setZoom(scale-.15));zoomIn.addEventListener("click",()=>setZoom(scale+.15));zoomRange.addEventListener("input",()=>setZoom(zoomRange.value));resetView.addEventListener("click",()=>{imageX=0;imageY=0;setZoom(1);});
  zoom.append(zoomOut,zoomRange,zoomIn,resetView);host.append(zoom);
  const textSizeBox=el("div","gse-text-size-control"),textSizeLabel=el("label","gse-text-size-label","Aa"),textSizeRange=el("input","gse-text-size-range");
  textSizeRange.type="range";textSizeRange.min="12";textSizeRange.max="88";textSizeRange.step="1";textSizeRange.value=String(textSize);textSizeRange.setAttribute("aria-label","Text size");
  textSizeRange.addEventListener("input",()=>applyTextSize(textSizeRange.value));textSizeBox.append(textSizeLabel,textSizeRange);host.append(textSizeBox);applyTextSize(textSize);applyPhotoTransform();
  const imageFile=$("storyImageFile");imageFile?.addEventListener("change",()=>{if(imageFile.files?.length){scale=1;imageX=0;imageY=0;applyPhotoTransform();effectIndex=0;applyImageEffect();}});
  $("storyImageRemove")?.addEventListener("click",()=>{scale=1;imageX=0;imageY=0;applyPhotoTransform();});
  const reset=()=>{ta.value="";ta.hidden=true;ta.style.pointerEvents="none";scale=1;imageX=0;imageY=0;applyPhotoTransform();effectIndex=0;applyImageEffect();ta.style.position="";ta.style.left="";ta.style.top="";ta.style.transform="";colorInput.value="#ffffff";ta.style.color="#ffffff";applyTextSize(34);palette.classList.remove("is-open");};
  form.addEventListener("reset",()=>setTimeout(reset,0));
  dlg.addEventListener("close",reset);
  const vv=window.visualViewport,upd=()=>dlg.style.setProperty("--vvh",(vv?vv.height:innerHeight)+"px");
  vv?.addEventListener("resize",upd);upd();
})();