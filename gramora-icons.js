/* GRAMORA unified Instagram-inspired outline icon system. Original app SVG artwork. */
(() => {
"use strict";
if(!document.querySelector('link[data-gramora-layout-fix]')){const l=document.createElement("link");l.rel="stylesheet";l.href="./gramora-layout-fix.css?v=1";l.dataset.gramoraLayoutFix="1";document.head.append(l);}
const p={
home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z"/>',
search:'<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/>',
messages:'<path d="M21 3 10.8 13.2"/><path d="m21 3-6.5 18-3.7-7.3L3 10Z"/>',
bookmark:'<path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4Z"/>',
profile:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
plus:'<path d="M12 5v14M5 12h14"/>',
heart:'<path d="M20.8 8.8c0 5.1-8.8 10.2-8.8 10.2S3.2 13.9 3.2 8.8A4.6 4.6 0 0 1 12 6.5a4.6 4.6 0 0 1 8.8 2.3Z"/>',
comment:'<path d="M20.5 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 21l1.9-4.7A8.5 8.5 0 1 1 20.5 11.5Z"/>',
repeat:'<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>',
moon:'<path d="M20.8 14.2A8.5 8.5 0 0 1 9.8 3.2 8.8 8.8 0 1 0 20.8 14.2Z"/>',
close:'<path d="m6 6 12 12M18 6 6 18"/>',
back:'<path d="m15 18-6-6 6-6"/>',
grid:'<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>'
};
const svg=n=>'<svg class="gramora-ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+(p[n]||p.plus)+'</svg>';
function set(node,name,label=false){
if(!node)return;
if(node.dataset.gramoraIcon===name&&node.querySelector(":scope > svg.gramora-ui-icon"))return;
const oldChildren=Array.from(node.childNodes);
const keep=oldChildren.filter(child=>{
 if(child.nodeType===1&&child.matches("svg.gramora-ui-icon"))return false;
 if(child.nodeType===3){
   const raw=child.textContent||"";
   if(/^[\s＋▣⟳◻♡♥☼☾◉✦≡✉⌂⌕♧☰×•·]*$/.test(raw))return false;
   child.textContent=raw.replace(/^\s*[＋▣⟳◻♡♥☼☾◉✦≡✉⌂⌕♧☰×•·]+\s*/,"");
   return !!child.textContent;
 }
 return true;
});
node.replaceChildren();
node.insertAdjacentHTML("afterbegin",svg(name));
keep.forEach(child=>node.append(child));
node.dataset.gramoraIcon=name;
}
function scan(root=document){
root.querySelectorAll?.(".nav-icon:not(.mobile-profile-avatar)").forEach(n=>{const v=n.closest(".nav")?.dataset.view;const m={home:"home",explore:"search",messages:"messages",saved:"bookmark",profile:"profile"}[v];if(m)set(n,m);});
root.querySelectorAll?.("#topCreate,.mobile-create > span,.sidebar-create > span:first-child").forEach(n=>set(n,"plus"));
root.querySelectorAll?.("#notificationBtn").forEach(n=>set(n,"bell"));
root.querySelectorAll?.("#settingsBtn").forEach(n=>set(n,"menu"));
root.querySelectorAll?.("#themeBtn").forEach(n=>set(n,document.body.classList.contains("light")?"moon":"sun"));
root.querySelectorAll?.(".post-actions .like,.post-detail-like").forEach(n=>set(n,"heart",true));
root.querySelectorAll?.(".post-actions .save").forEach(n=>set(n,"bookmark",true));
root.querySelectorAll?.(".post-actions .repost").forEach(n=>set(n,"repeat",true));
root.querySelectorAll?.(".post-comment-open").forEach(n=>set(n,"comment",true));
root.querySelectorAll?.(".ig-profile-tabs [data-profile-tab='posts']").forEach(n=>set(n,"grid"));
root.querySelectorAll?.(".ig-profile-tabs [data-profile-tab='reposts']").forEach(n=>set(n,"repeat"));
root.querySelectorAll?.(".close-btn,.follow-list-close").forEach(n=>set(n,"close"));
root.querySelectorAll?.(".gramora-chat-back,.profile-edit-back").forEach(n=>set(n,"back"));
root.querySelectorAll?.(".gramora-chat-find-head button").forEach(n=>set(n,"close"));
}
function removeStrayEscapedLineBreaks(){
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 const remove=[];
 while(walker.nextNode()){
  const node=walker.currentNode;
  const value=(node.nodeValue||"").trim();
  if(value==="\\n"||value==="\\n\\n"||value==="\\n\\n\\n")remove.push(node);
 }
 remove.forEach(node=>node.remove());
}
let pending=false;const queue=()=>{if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;removeStrayEscapedLineBreaks();scan();});};
const start=()=>{removeStrayEscapedLineBreaks();scan();new MutationObserver(queue).observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["class"]});};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
})();