import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, updateProfile, sendPasswordResetEmail, signOut } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, runTransaction, serverTimestamp, Timestamp, collection, addDoc, query, orderBy, limit, onSnapshot, getDocs, where, deleteDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const configured = firebaseConfig.apiKey !== "PASTE_YOUR_API_KEY" &&
  firebaseConfig.projectId !== "PASTE_YOUR_PROJECT_ID" &&
  firebaseConfig.appId !== "PASTE_YOUR_APP_ID";
const app = configured ? initializeApp(firebaseConfig) : null;
let auth = app ? getAuth(app) : null;
let db = app ? getFirestore(app) : null;
let activeApp = app;
let activeAuthUnsubscribe = null;
const accountInstances = new Map();
let savedAccounts = [];
let activeFeedUnsubscribe=null;
let activeView="home";
try { savedAccounts = JSON.parse(localStorage.getItem("gramoraAccounts") || "[]"); } catch { savedAccounts = []; }
function saveAccountList(){ localStorage.setItem("gramoraAccounts", JSON.stringify(savedAccounts)); }
function accountAppName(uid){ return "gramora-account-" + uid; }
function getAccountInstance(uid){
  if(accountInstances.has(uid)) return accountInstances.get(uid);
  const record=savedAccounts.find(x=>x.uid===uid);
  const name=record?.appName||accountAppName(uid);
  const secondaryApp=getApps().find(x=>x.name===name)||initializeApp(firebaseConfig,name);
  const secondaryAuth=getAuth(secondaryApp);
  const secondaryDb=getFirestore(secondaryApp);
  const instance={app:secondaryApp,auth:secondaryAuth,db:secondaryDb};
  accountInstances.set(uid,instance);
  return instance;
}
function rememberAccount(user, appName){
  if(!user)return;
  const record={uid:user.uid,email:user.email||"",displayName:user.displayName||"",appName};
  savedAccounts=[record,...savedAccounts.filter(x=>x.uid!==user.uid)];
  saveAccountList();
  renderAccountSwitcher();
}
function updateMobileProfileAvatar(profile,user){
  const avatar=document.getElementById("mobileProfileAvatar");
  if(!avatar)return;
  const name=profile?.displayName||user?.displayName||user?.email||"G";
  avatar.replaceChildren();
  if(profile?.photoURL){
    const img=document.createElement("img");img.src=profile.photoURL;img.alt="";img.loading="eager";
    img.onerror=()=>{avatar.textContent=name.trim().charAt(0).toUpperCase()||"G";};
    avatar.append(img);
  }else avatar.textContent=name.trim().charAt(0).toUpperCase()||"G";
  avatar.setAttribute("aria-label",name+" profile");
}

function activateAccount(instance){
  if(activeAuthUnsubscribe) activeAuthUnsubscribe();
  if(activeFeedUnsubscribe){activeFeedUnsubscribe();activeFeedUnsubscribe=null;}
  activeApp=instance.app; auth=instance.auth; db=instance.db;
  const selectedApp=instance.app;
  const selectedAuth=instance.auth;
  const selectedDb=instance.db;
  activeAuthUnsubscribe=onAuthStateChanged(selectedAuth,async user=>{
    if(auth!==selectedAuth || db!==selectedDb)return;
    gate.hidden=!!user;
    document.body.classList.remove("auth-pending");
    document.body.classList.toggle("auth-required",!user);
    if(accountBar) accountBar.hidden=!user;
    if(user){
      rememberAccount(user,selectedApp===app?"[DEFAULT]":selectedApp.name);
      if(accountLabel) accountLabel.textContent=user.displayName||user.email||"Account";
      try{
        await ensureProfile(user);
        if(auth!==selectedAuth || auth.currentUser?.uid!==user.uid)return;
        const navProfileSnap=await getDoc(doc(selectedDb,"userProfiles",user.uid));
        updateMobileProfileAvatar(navProfileSnap.exists()?navProfileSnap.data():{},user);
        startPostsFeed(user);
        startStoriesFeed(user);
        // Keep the current screen open, but reload it using the newly active account.
        if(activeView==="profile") await loadProfilePage(user);
        else if(activeView==="explore") await loadExplorePage(user);
        else if(activeView==="home") await getDocsForFeed();
        else if(activeView==="saved") showFeedMessage("Saved posts for this account will appear here.");
      }catch(error){console.error(error);showMessage("Could not load your profile. Check Firestore Security Rules.",true);}
    }
    renderAccountSwitcher();
  });
}
function renderAccountSwitcher(){
  const list=document.getElementById("accountSwitcherList");
  if(!list)return;
  list.replaceChildren();
  const currentUid=auth?.currentUser?.uid;
  savedAccounts.forEach(record=>{
    const row=document.createElement("div");row.className="account-switch-row";
    const info=document.createElement("div");info.className="account-switch-info";
    const avatar=document.createElement("span");avatar.className="account-switch-avatar";
    avatar.textContent=(record.displayName||record.email||"G").charAt(0).toUpperCase();
    const labels=document.createElement("span");
    const name=document.createElement("b");name.textContent=record.displayName||"GRAMORA member";
    const email=document.createElement("small");email.textContent=record.email||"";
    labels.append(name,email);info.append(avatar,labels);
    const button=document.createElement("button");button.type="button";
    button.className="account-switch-button";button.textContent=record.uid===currentUid?"Active":"Switch";
    button.disabled=record.uid===currentUid;
    button.addEventListener("click",async()=>{
      try{
        const instance=record.appName==="[DEFAULT]"?{app,auth:getAuth(app),db:getFirestore(app)}:getAccountInstance(record.uid);
        activateAccount(instance);
        document.getElementById("settingsDialog")?.close();
      }catch(error){console.error(error);alert("Account switch nahi ho paya. Dobara try karein.");}
    });
    row.append(info,button);list.append(row);
  });
}

const gate = document.getElementById("authGate");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const message = document.getElementById("authMessage");
const title = document.getElementById("authTitle");
const subtitle = document.getElementById("authSubtitle");
const accountBar = document.getElementById("accountBar");
const accountLabel = document.getElementById("accountLabel");

function showMessage(text, isError=false){ message.textContent=text; message.classList.toggle("error",isError); }
if (!configured) {
  showMessage("Firebase setup required: add your Firebase Web app config before creating accounts.", true);
  document.querySelectorAll(".auth-form button, #forgotPassword").forEach(button => button.disabled = true);
  subtitle.textContent = "One-time Firebase setup is needed before account creation.";
}
function switchMode(mode){
  const signup=mode==="signup";
  loginForm.hidden=signup; signupForm.hidden=!signup;
  document.getElementById("showLogin").classList.toggle("active",!signup);
  document.getElementById("showSignup").classList.toggle("active",signup);
  title.textContent=signup?"Join the community":"Welcome back";
  subtitle.textContent=signup?"Create your GRAMORA account.":"Sign in to continue to your community.";
  showMessage("");
}
document.getElementById("showLogin").addEventListener("click",()=>switchMode("login"));
document.getElementById("showSignup").addEventListener("click",()=>switchMode("signup"));

async function saveNewUserProfile(user, name, username) {
  const profileRef=doc(db,"userProfiles",user.uid);
  const usernameRef=doc(db,"usernames",username);
  await runTransaction(db,async transaction=>{
    const existing=await transaction.get(usernameRef);
    if(existing.exists()) throw new Error("GRAMORA_USERNAME_TAKEN");
    transaction.set(usernameRef,{uid:user.uid,createdAt:serverTimestamp()});
    transaction.set(profileRef,{
      uid:user.uid,displayName:name,username,email:user.email||"",
      bio:"",photoURL:"",followersCount:0,followingCount:0,
      createdAt:serverTimestamp(),updatedAt:serverTimestamp()
    });
  });
}
async function ensureProfile(user) {
  const profileRef=doc(db,"userProfiles",user.uid);
  const snap=await getDoc(profileRef);
  if(!snap.exists()){
    await setDoc(profileRef,{
      uid:user.uid,displayName:user.displayName||"GRAMORA member",
      username:"",email:user.email||"",bio:"",photoURL:"",
      followersCount:0,followingCount:0,
      createdAt:serverTimestamp(),updatedAt:serverTimestamp()
    });
  }
}

signupForm.addEventListener("submit",async event=>{
  event.preventDefault();
  const name=document.getElementById("signupName").value.trim();
  const username=document.getElementById("signupUsername").value.trim().toLowerCase();
  const email=document.getElementById("signupEmail").value.trim();
  const password=document.getElementById("signupPassword").value;
  if(!/^[a-z0-9_.]{3,20}$/.test(username)){showMessage("Username must be 3–20 characters (letters, numbers, _ or .).",true);return;}
  const button=signupForm.querySelector("button[type=submit]");button.disabled=true;button.textContent="Creating account…";
  try{
    const credential=await createUserWithEmailAndPassword(auth,email,password);
    await updateProfile(credential.user,{displayName:name});
    await saveNewUserProfile(credential.user,name,username);
    showMessage("Account created and profile saved. Welcome to GRAMORA!");
  }catch(error){
    if(error.message==="GRAMORA_USERNAME_TAKEN") showMessage("This username is already taken. Please choose another.",true);
    else showMessage(authError(error.code),true);
  }finally{button.disabled=false;button.textContent="Create my account";}
});

loginForm.addEventListener("submit",async event=>{
  event.preventDefault();
  const email=document.getElementById("loginEmail").value.trim();
  const password=document.getElementById("loginPassword").value;
  const button=loginForm.querySelector("button[type=submit]");button.disabled=true;button.textContent="Signing in…";
  try{await signInWithEmailAndPassword(auth,email,password);}
  catch(error){showMessage(authError(error.code),true);}
  finally{button.disabled=false;button.textContent="Log in";}
});

document.getElementById("forgotPassword").addEventListener("click",async()=>{
  const email=document.getElementById("loginEmail").value.trim();
  if(!email){showMessage("Enter your email address first.",true);return;}
  try{await sendPasswordResetEmail(auth,email);showMessage("Password reset email sent. Check your inbox.");}
  catch(error){showMessage(authError(error.code),true);}
});


if(auth) activateAccount({app,auth,db});
else { document.body.classList.remove("auth-pending"); gate.hidden=false; document.body.classList.add("auth-required"); }


let activeStoriesUnsubscribe=null;
let activeStoryDocs=[];
const storyProfileCache=new Map();
function storySeenKey(id){return "gramora-story-seen-"+(auth?.currentUser?.uid||"guest")+"-"+id;}
function storyWasSeen(id){try{return localStorage.getItem(storySeenKey(id))==="1";}catch(error){return false;}}
function markStorySeen(id){try{localStorage.setItem(storySeenKey(id),"1");}catch(error){}}
function startStoriesFeed(user){
  if(activeStoriesUnsubscribe)activeStoriesUnsubscribe();
  const storiesQuery=query(collection(db,"stories"),orderBy("createdAt","desc"),limit(100));
  activeStoriesUnsubscribe=onSnapshot(storiesQuery,snapshot=>{
    activeStoryDocs=snapshot.docs.filter(item=>{
      const expiry=item.data().expiresAt;
      return expiry?.toMillis ? expiry.toMillis()>Date.now() : false;
    });
    renderStories(activeStoryDocs);
  },error=>{
    console.error("Stories feed error:",error);
    const hint=document.getElementById("storyCreateStatus");
    if(hint)hint.textContent="Stories load nahi hui. Firestore Rules check karein.";
  });
}
async function getStoryProfile(uid){
  if(storyProfileCache.has(uid))return storyProfileCache.get(uid);
  try{
    const snap=await getDoc(doc(db,"userProfiles",uid));
    const profile=snap.exists()?snap.data():{};
    storyProfileCache.set(uid,profile);return profile;
  }catch(error){return {};}
}
function makeStoryAvatar(ring,profile,name){
  ring.replaceChildren();
  if(profile?.photoURL){
    const img=document.createElement("img");img.src=profile.photoURL;img.alt=name+" profile photo";
    img.onerror=()=>{ring.replaceChildren();const fallback=document.createElement("span");fallback.textContent=(name||"G").trim().charAt(0).toUpperCase();ring.append(fallback);};
    ring.append(img);
  }else{
    const initials=document.createElement("span");initials.textContent=(name||"G").trim().charAt(0).toUpperCase();ring.append(initials);
  }
}
function renderStories(docs){
  const strip=document.querySelector(".stories");if(!strip)return;
  strip.replaceChildren();
  const create=document.createElement("button");create.className="story your-story";create.type="button";
  const createRing=document.createElement("span");createRing.className="story-ring story-add-ring";
  const current=auth?.currentUser;const currentProfile=storyProfileCache.get(current?.uid)||{};
  makeStoryAvatar(createRing,currentProfile,currentProfile.displayName||current?.displayName||"G");
  const plus=document.createElement("i");plus.textContent="＋";createRing.append(plus);
  const createLabel=document.createElement("small");createLabel.textContent="Your story";
  create.append(createRing,createLabel);
  create.addEventListener("click",()=>document.getElementById("storyCreateDialog")?.showModal());
  strip.append(create);
  const latestByUser=new Map();
  docs.forEach(storyDoc=>{const uid=storyDoc.data().uid;if(uid&&!latestByUser.has(uid))latestByUser.set(uid,storyDoc);});
  latestByUser.forEach((storyDoc,uid)=>{
    const data=storyDoc.data(),name=data.displayName||"GRAMORA member";
    const item=document.createElement("button");item.type="button";item.className="story";
    const ring=document.createElement("span");ring.className="story-ring story-user-ring "+(storyWasSeen(storyDoc.id)?"story-seen":"story-unseen");
    const label=document.createElement("small");label.textContent=uid===current?.uid?"Your story":name;
    const profile=storyProfileCache.get(uid)||{};
    makeStoryAvatar(ring,profile,name);
    item.append(ring,label);item.addEventListener("click",()=>openStoryViewer(docs,storyDoc.id));
    strip.append(item);
    if(!storyProfileCache.has(uid))getStoryProfile(uid).then(p=>{if(ring.isConnected)makeStoryAvatar(ring,p,name);});
  });
  if(current&&!storyProfileCache.has(current.uid))getStoryProfile(current.uid).then(p=>{
    if(createRing.isConnected)makeStoryAvatar(createRing,p,p.displayName||current.displayName||"G");
    if(createRing.isConnected&&!createRing.querySelector("i")){const plusIcon=document.createElement("i");plusIcon.textContent="＋";createRing.append(plusIcon);}
  });
}
async function recordStoryView(storyId,storyData){
  const user=auth?.currentUser;if(!user||user.uid===storyData.uid)return;
  try{
    const ref=doc(db,"storyViews",storyId+"_"+user.uid);
    const existing=await getDoc(ref);
    if(!existing.exists()){
      const profileSnap=await getDoc(doc(db,"userProfiles",user.uid));
      const profile=profileSnap.exists()?profileSnap.data():{};
      await setDoc(ref,{storyId,storyUid:storyData.uid,uid:user.uid,displayName:profile.displayName||user.displayName||"GRAMORA member",createdAt:serverTimestamp()});
    }
  }catch(error){console.error("Story view could not be recorded:",error);}
}
async function loadStoryViewers(storyId,storyData){
  const section=document.getElementById("storyViewerViews");
  const list=document.getElementById("storyViewerViewList");
  const button=document.getElementById("storyViewerViewToggle");
  if(!section||!list||!button)return;
  const isOwner=storyData.uid===auth?.currentUser?.uid;
  section.hidden=!isOwner;
  list.hidden=true;list.replaceChildren();
  if(!isOwner)return;
  try{
    const snap=await getDocs(query(collection(db,"storyViews"),where("storyId","==",storyId),where("storyUid","==",auth.currentUser.uid)));
    button.textContent="Viewers · "+snap.size;
    snap.docs.sort((a,b)=>(b.data().createdAt?.toMillis?.()||0)-(a.data().createdAt?.toMillis?.()||0)).forEach(item=>{
      const row=document.createElement("p");row.className="story-viewer-person";
      row.textContent=item.data().displayName||"GRAMORA member";list.append(row);
    });
    if(!snap.size)list.textContent="Abhi kisi ne story nahi dekhi.";
  }catch(error){console.error("Story viewers load failed:",error);button.textContent="Viewers";list.textContent="Viewers load nahi ho paye. Firestore Rules check karein.";}
}
function openStoryViewer(docs,id){
  const storyDoc=docs.find(item=>item.id===id);if(!storyDoc)return;
  const data=storyDoc.data(),dialog=document.getElementById("storyViewerDialog");
  dialog.dataset.storyId=id;
  const content=document.getElementById("storyViewerText");
  const byline=document.getElementById("storyViewerByline");
  const song=document.getElementById("storyViewerSong");
  const deleteButton=document.getElementById("storyViewerDelete");
  content.textContent=data.text||"";
  byline.textContent=(data.displayName||"GRAMORA member")+" · "+formatPostDate(data.createdAt);
  markStorySeen(id);
  recordStoryView(id,data);
  loadStoryViewers(id,data);
  const highlightNav=document.getElementById("highlightStoryNav");
  if(highlightNav){
    const index=Number(dialog.dataset.highlightIndex||0),items=dialog._highlightStories||[];
    highlightNav.hidden=!items.length;
    const prev=document.getElementById("highlightStoryPrev"),next=document.getElementById("highlightStoryNext");
    if(prev)prev.disabled=index<=0;
    if(next)next.disabled=index>=items.length-1;
    if(items.length){
      if(prev)prev.onclick=()=>{dialog.dataset.highlightIndex=String(index-1);openStoryViewer(items,items[index-1].id);};
      if(next)next.onclick=()=>{dialog.dataset.highlightIndex=String(index+1);openStoryViewer(items,items[index+1].id);};
    }
  }
  song.replaceChildren();
  const audio=document.getElementById("storyViewerAudio");
  if(audio){audio.pause();audio.removeAttribute("src");audio.load();audio.hidden=true;}
  if(data.songTitle){
    const title=document.createElement("p");title.className="story-song-title";title.textContent="♫ "+data.songTitle+(data.songArtist?" — "+data.songArtist:"");
    song.append(title);
    if(data.previewUrl&&audio){
      audio.src=data.previewUrl;audio.hidden=false;audio.currentTime=0;
    }else if(data.songUrl){
      const link=document.createElement("a");link.className="story-song-link";link.textContent="Open song ↗";
      link.href=data.songUrl;link.target="_blank";link.rel="noopener noreferrer";song.append(link);
    }
  }
  if(deleteButton){
    deleteButton.hidden=data.uid!==auth?.currentUser?.uid;
    deleteButton.onclick=async()=>{
      if(!confirm("Delete this story?"))return;
      deleteButton.disabled=true;deleteButton.textContent="Deleting…";
      try{
        await deleteDoc(doc(db,"stories",id));audio?.pause();dialog.close();
      }catch(error){console.error("Story delete failed:",error);alert("Story delete nahi hui. Firestore Rules check karein.");}
      finally{deleteButton.disabled=false;deleteButton.textContent="Delete story";}
    };
  }
  renderStories(activeStoryDocs);
  loadStoryEngagement(id,data);
  dialog.showModal();
  if(audio&&!audio.hidden){
    const playAttempt=audio.play();
    if(playAttempt&&typeof playAttempt.catch==="function")playAttempt.catch(()=>{});
  }
}
async function loadStoryEngagement(storyId,storyData){
  const likeButton=document.getElementById("storyViewerLike");
  const likeCount=document.getElementById("storyViewerLikeCount");
  const replyList=document.getElementById("storyReplyList");
  const replyStatus=document.getElementById("storyReplyStatus");
  const currentUid=auth?.currentUser?.uid;
  if(!currentUid)return;
  try{
    const likesSnap=await getDocs(query(collection(db,"storyLikes"),where("storyId","==",storyId)));
    const ownLikeId=storyId+"_"+currentUid;
    const liked=likesSnap.docs.some(item=>item.id===ownLikeId);
    if(likeCount)likeCount.textContent=String(likesSnap.size);
    if(likeButton){
      likeButton.classList.toggle("liked",liked);
      likeButton.setAttribute("aria-pressed",String(liked));
      likeButton.innerHTML=(liked?"♥":"♡")+" <span>Like</span>";
      likeButton.onclick=async()=>{
        likeButton.disabled=true;
        try{
          const ref=doc(db,"storyLikes",ownLikeId);
          const snap=await getDoc(ref);
          if(snap.exists())await deleteDoc(ref);
          else await setDoc(ref,{storyId,storyUid:storyData.uid,uid:currentUid,createdAt:serverTimestamp()});
          await loadStoryEngagement(storyId,storyData);
        }catch(error){console.error("Story like failed:",error);if(replyStatus)replyStatus.textContent="Like save nahi hua. Firestore Rules check karein.";}
        finally{likeButton.disabled=false;}
      };
    }
  }catch(error){console.error("Story likes load failed:",error);}
  try{
    const repliesSnap=await getDocs(query(collection(db,"storyReplies"),where("storyId","==",storyId)));
    const replies=repliesSnap.docs.map(item=>({id:item.id,...item.data()})).sort((x,y)=>(y.createdAt?.toMillis?.()||0)-(x.createdAt?.toMillis?.()||0));
    if(replyList){
      replyList.replaceChildren();
      replies.forEach(reply=>{
        const row=document.createElement("p");row.className="story-reply-item";
        const who=document.createElement("b");who.textContent=(reply.displayName||"Member")+": ";
        const body=document.createElement("span");body.textContent=reply.text||"";
        row.append(who,body);replyList.append(row);
      });
      if(!replies.length)replyList.textContent="Abhi koi reply nahi hai.";
    }
  }catch(error){console.error("Story replies load failed:",error);}
}
const storyReplyForm=document.getElementById("storyReplyForm");
storyReplyForm?.addEventListener("submit",async event=>{
  event.preventDefault();
  const input=document.getElementById("storyReplyInput");
  const status=document.getElementById("storyReplyStatus");
  const text=input?.value.trim();
  const storyId=document.getElementById("storyViewerDialog")?.dataset.storyId;
  const story=activeStoryDocs.find(item=>item.id===storyId);
  if(!story||!text||!auth?.currentUser)return;
  const button=storyReplyForm.querySelector('button[type="submit"]');
  button.disabled=true;status.textContent="Reply bhej rahe hain…";
  try{
    const user=auth.currentUser;
    const profileSnap=await getDoc(doc(db,"userProfiles",user.uid));
    const profile=profileSnap.exists()?profileSnap.data():{};
    await addDoc(collection(db,"storyReplies"),{
      storyId,storyOwnerUid:story.data().uid,uid:user.uid,
      displayName:profile.displayName||user.displayName||"GRAMORA member",
      text,createdAt:serverTimestamp()
    });
    input.value="";status.textContent="Reply bhej diya!";
    await loadStoryEngagement(storyId,story.data());
  }catch(error){console.error("Story reply failed:",error);status.textContent="Reply nahi bhej paye. Firestore Rules check karein.";}
  finally{button.disabled=false;}
});
const songSearchButton=document.getElementById("storySongSearchButton");
const songSearchInput=document.getElementById("storySongSearch");
const songSearchResults=document.getElementById("storySongResults");
const selectedPreview=document.getElementById("storySongPreviewUrl");
songSearchButton?.addEventListener("click",async()=>{
  const term=songSearchInput?.value.trim();
  if(!term){songSearchResults.textContent="Song ka naam ya singer likhein.";return;}
  songSearchButton.disabled=true;songSearchResults.textContent="Songs search ho rahe hain…";
  try{
    const response=await fetch("https://itunes.apple.com/search?term="+encodeURIComponent(term)+"&entity=song&limit=12&country=IN");
    if(!response.ok)throw new Error("Song search service unavailable");
    const result=await response.json();songSearchResults.replaceChildren();
    if(!result.results?.length){songSearchResults.textContent="Koi song nahi mila. Dusra naam try karein.";return;}
    result.results.forEach(track=>{
      const option=document.createElement("button");option.type="button";option.className="story-song-result";
      const title=document.createElement("b");title.textContent=track.trackName||"Unknown song";
      const artist=document.createElement("small");artist.textContent=track.artistName||"Unknown artist";
      option.append(title,artist);
      option.addEventListener("click",()=>{
        document.getElementById("storySongTitle").value=track.trackName||"";
        document.getElementById("storySongArtist").value=track.artistName||"";
        document.getElementById("storySongUrl").value=track.trackViewUrl||"";
        selectedPreview.value=track.previewUrl||"";
        songSearchResults.replaceChildren();
        const chosen=document.createElement("p");chosen.className="muted tiny";
        chosen.textContent=(track.trackName||"Song")+" selected · "+(track.previewUrl?"30-second preview will play in your story.":"Is song ka preview available nahi hai.");
        songSearchResults.append(chosen);
      });
      songSearchResults.append(option);
    });
  }catch(error){console.error("Song search failed:",error);songSearchResults.textContent="Song search abhi nahi ho payi. Internet connection check karein.";}
  finally{songSearchButton.disabled=false;}
});
const storyForm=document.getElementById("storyForm");
storyForm?.addEventListener("submit",async event=>{
  event.preventDefault();
  const status=document.getElementById("storyCreateStatus");
  const button=storyForm.querySelector('button[type="submit"]');
  const text=document.getElementById("storyText").value.trim();
  const songTitle=document.getElementById("storySongTitle").value.trim();
  const songArtist=document.getElementById("storySongArtist").value.trim();
  const songUrl=document.getElementById("storySongUrl").value.trim();
  const previewUrl=selectedPreview?.value.trim()||"";
  if(!auth?.currentUser){status.textContent="Story share karne ke liye login karein.";return;}
  if(!text){status.textContent="Pehle apni text story likhein.";return;}
  if(songUrl&&!/^https:\/\/(open\.spotify\.com|music\.apple\.com|music\.youtube\.com|www\.youtube\.com|youtu\.be)\//i.test(songUrl)){
    status.textContent="Valid Apple Music, Spotify ya YouTube song link add karein.";return;
  }
  button.disabled=true;button.textContent="Sharing…";status.textContent="Story publish ho rahi hai…";
  try{
    const user=auth.currentUser;
    const profileSnap=await getDoc(doc(db,"userProfiles",user.uid));
    const profile=profileSnap.exists()?profileSnap.data():{};
    await addDoc(collection(db,"stories"),{
      uid:user.uid,displayName:profile.displayName||user.displayName||"GRAMORA member",
      text,songTitle,songArtist,songUrl,previewUrl,
      createdAt:serverTimestamp(),expiresAt:Timestamp.fromMillis(Date.now()+24*60*60*1000)
    });
    storyForm.reset();if(selectedPreview)selectedPreview.value="";
    songSearchResults?.replaceChildren();status.textContent="Story share ho gayi!";
    document.getElementById("storyCreateDialog").close();
  }catch(error){
    console.error("Story publish failed:",error);
    status.textContent=error.code==="permission-denied"?"Firestore Rules publish karein.":"Story publish nahi hui: "+(error.message||"Try again.");
  }finally{button.disabled=false;button.textContent="Share story";}
});
document.getElementById("closeStoryCreate")?.addEventListener("click",()=>document.getElementById("storyCreateDialog").close());
document.getElementById("closeStoryViewer")?.addEventListener("click",()=>{const audio=document.getElementById("storyViewerAudio");audio?.pause();document.getElementById("storyViewerDialog").close();});
document.getElementById("storyViewerDialog")?.addEventListener("close",()=>{const audio=document.getElementById("storyViewerAudio");audio?.pause();});
function startPostsFeed(user){
  if(activeFeedUnsubscribe) activeFeedUnsubscribe();
  const postsQuery=query(collection(db,"posts"),orderBy("createdAt","desc"),limit(40));
  activeFeedUnsubscribe=onSnapshot(postsQuery,snapshot=>{
    if(activeView==="home") renderPosts(snapshot.docs);
  },error=>{
    console.error("Posts feed error:",error);
    if(activeView==="home") showFeedMessage("Could not load posts ("+(error.code||"unknown")+"): "+(error.message||"Check Firestore Rules."));
  });
}
function showFeedMessage(text){
  const feed=document.getElementById("feed");
  feed.replaceChildren();
  const p=document.createElement("p");p.className="muted";p.textContent=text;feed.append(p);
}
function renderPosts(docs){
  const feed=document.getElementById("feed");
  feed.replaceChildren();
  if(!docs.length){
    const empty=document.createElement("div");empty.className="empty-welcome";
    const heading=document.createElement("h2");heading.textContent="Your feed is ready.";
    const note=document.createElement("p");note.textContent="Be the first to share a moment with the GRAMORA community.";
    empty.append(heading,note);feed.append(empty);return;
  }
  docs.forEach(postDoc=>{
    const data=postDoc.data();
    const article=document.createElement("article");article.className="post";
    const head=document.createElement("div");head.className="post-head";
    const avatar=document.createElement("div");avatar.className="avatar";
    avatar.textContent=(data.displayName||"G").trim().charAt(0).toUpperCase();
    if(data.photoURL){const img=document.createElement("img");img.src=data.photoURL;img.alt=(data.displayName||"User")+" profile photo";avatar.textContent="";avatar.append(img);}
    else if(data.uid){getDoc(doc(db,"userProfiles",data.uid)).then(profileSnap=>{if(profileSnap.exists()){const photo=profileSnap.data().photoURL;if(photo&&avatar.isConnected){const img=document.createElement("img");img.src=photo;img.alt=(data.displayName||"User")+" profile photo";avatar.textContent="";avatar.append(img);}}}).catch(error=>console.warn("Post author photo unavailable:",error));}
    const identity=document.createElement("div");
    const name=document.createElement("b");name.textContent=data.displayName||"GRAMORA member";
    const meta=document.createElement("small");
    meta.textContent=(data.username?"@"+data.username+" · ":"")+formatPostDate(data.createdAt);
    identity.append(name,meta);head.append(avatar,identity);
    const content=document.createElement("p");content.className="post-text";content.textContent=data.text||"";
    const actions=document.createElement("div");actions.className="post-actions";
    const like=document.createElement("button");like.className="like";like.type="button";like.innerHTML="♡ <span>Like</span>";
    const save=document.createElement("button");save.className="save";save.type="button";save.innerHTML="▣ <span>Save</span>";
    actions.append(like,save);
    if(auth?.currentUser?.uid===data.uid){const del=document.createElement("button");del.className="delete-post";del.type="button";del.textContent="Delete";del.addEventListener("click",()=>deleteOwnPost(postDoc.id,del,()=>getDocsForFeed()));actions.append(del);}
    article.append(head,content,actions);feed.append(article);
  });
}
async function deleteOwnPost(postId,button,afterDelete){
  if(!auth?.currentUser)return;
  if(!confirm("Delete this post permanently?"))return;
  button.disabled=true;button.textContent="Deleting…";
  try{await deleteDoc(doc(db,"posts",postId));if(typeof afterDelete==="function")await afterDelete();}
  catch(error){console.error("Delete post failed:",error);alert(error.code==="permission-denied"?"Firestore Rules denied deleting this post. Publish the latest rules.":"Could not delete this post. Please try again.");button.disabled=false;button.textContent="Delete";}
}
function formatPostDate(timestamp){
  if(!timestamp||!timestamp.toDate)return "Just now";
  return timestamp.toDate().toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});
}
document.addEventListener("gramora:view",event=>{
  activeView=event.detail;
  if(activeView==="profile" && auth?.currentUser) loadProfilePage(auth.currentUser);
  if(activeView==="explore" && auth?.currentUser) loadExplorePage(auth.currentUser);
  if(activeView==="home"&&auth?.currentUser){
    getDocsForFeed();
  }
});

async function getUsernameForUid(uid,profileData={}){
  if(profileData.username)return profileData.username;
  try{
    const snap=await getDocs(query(collection(db,"usernames"),where("uid","==",uid),limit(1)));
    return snap.empty?"":snap.docs[0].id;
  }catch(error){console.warn("Username lookup failed:",error);return "";}
}
async function loadExplorePage(user){
  const feed=document.getElementById("feed");
  feed.innerHTML='<section class="explore-page"><h2>Explore people</h2><p class="muted">Find people in the GRAMORA community.</p><input id="peopleSearch" type="search" placeholder="Search name or @username" autocomplete="off"><p id="exploreStatus" class="muted tiny">Loading community…</p><div id="peopleResults" class="people-results"></div></section>';
  const input=feed.querySelector("#peopleSearch");
  const status=feed.querySelector("#exploreStatus");
  const results=feed.querySelector("#peopleResults");
  try{
    const [profilesSnap,usernamesSnap,ownProfileSnap]=await Promise.all([
      getDocs(query(collection(db,"userProfiles"),limit(100))),
      getDocs(query(collection(db,"usernames"),limit(500))),
      getDoc(doc(db,"userProfiles",user.uid))
    ]);
    const usernameByUid=new Map();
    usernamesSnap.docs.forEach(d=>{const data=d.data();if(data.uid)usernameByUid.set(data.uid,d.id);});
    const profileMap=new Map();
    profilesSnap.docs.forEach(d=>{
      const data=d.data(),uid=data.uid||d.id;
      profileMap.set(uid,{...data,id:d.id,uid,username:data.username||usernameByUid.get(uid)||""});
    });
    if(ownProfileSnap.exists()){
      const data=ownProfileSnap.data();
      profileMap.set(user.uid,{...data,id:user.uid,uid:user.uid,username:data.username||usernameByUid.get(user.uid)||""});
    }
    const people=[...profileMap.values()];
    function render(term=""){
      const q=term.trim().toLowerCase().replace(/^@/,"");
      const matches=people.filter(p=>(p.displayName||"").toLowerCase().includes(q)||(p.username||"").toLowerCase().includes(q));
      results.replaceChildren();
      if(!matches.length){
        const empty=document.createElement("p");empty.className="muted";empty.textContent=q?"No matching people found.":"No other profiles to show yet.";results.append(empty);
        status.textContent="";return;
      }
      matches.slice(0,40).forEach(person=>{
        const card=document.createElement("button");card.type="button";card.className="person-result";card.addEventListener("click",()=>person.uid===user.uid?loadProfilePage(user):loadPublicProfile(user,person.uid));
        const avatar=document.createElement("div");avatar.className="avatar";
        if(person.photoURL){const img=document.createElement("img");img.src=person.photoURL;img.alt="";avatar.append(img);}else avatar.textContent=(person.displayName||"G").trim().charAt(0).toUpperCase();
        const info=document.createElement("div");info.className="person-info";
        const name=document.createElement("b");name.textContent=person.displayName||"GRAMORA member";
        const handle=document.createElement("small");handle.textContent=person.username?"@"+person.username:"Username not set";
        info.append(name,handle);card.append(avatar,info);results.append(card);
      });
      status.textContent=matches.length+" people found";
    }
    input.addEventListener("input",()=>render(input.value));
    render();
    if(!people.length)status.textContent="No other profiles yet. Invite friends to join GRAMORA.";
  }catch(error){
    console.error("Explore profiles error:",error);
    status.textContent=error.code==="permission-denied"?"Explore needs signed-in profile read permission in Firestore Rules.":"Could not load people. Check your connection.";
  }
}
async function loadPublicProfile(viewer,targetUid){
  const feed=document.getElementById("feed");
  if(targetUid===viewer.uid){loadProfilePage(viewer);return;}
  feed.innerHTML='<div class="profile-loading">Loading profile…</div>';
  try{
    const snap=await getDoc(doc(db,"userProfiles",targetUid));
    if(!snap.exists()){feed.textContent="Profile unavailable.";return;}
    const p=snap.data();
    p.username=await getUsernameForUid(targetUid,p);
    let posts=[],followersCount=0,followingCount=0,already=false;
    const results=await Promise.allSettled([
      getDocs(query(collection(db,"posts"),where("uid","==",targetUid),limit(60))),
      getDocs(query(collection(db,"follows"),where("followingUid","==",targetUid),limit(100))),
      getDocs(query(collection(db,"follows"),where("followerUid","==",targetUid),limit(100))),
      getDoc(doc(db,"follows",viewer.uid+"_"+targetUid))
    ]);
    if(results[0].status==="fulfilled")posts=results[0].value.docs;
    if(results[1].status==="fulfilled")followersCount=results[1].value.size;
    if(results[2].status==="fulfilled")followingCount=results[2].value.size;
    if(results[3].status==="fulfilled")already=results[3].value.exists();
    const panel=document.createElement("section");panel.className="ig-profile";
    const avatar=p.photoURL?'<img alt="" src="'+escapeHtml(p.photoURL)+'">':escapeHtml((p.displayName||"G").charAt(0).toUpperCase());
    panel.innerHTML='<div class="ig-profile-top"><div class="ig-avatar-wrap"><div class="ig-profile-avatar">'+avatar+'</div></div><div class="ig-profile-summary"><div class="ig-profile-username"><strong>@'+escapeHtml(p.username||"member")+'</strong></div><div class="ig-profile-stats"><span class="profile-stat"><b>'+posts.length+'</b><small>posts</small></span><button class="stat-open profile-stat" data-list="followers" type="button"><b>'+followersCount+'</b><small>followers</small></button><button class="stat-open profile-stat" data-list="following" type="button"><b>'+followingCount+'</b><small>following</small></button></div></div></div><div class="ig-profile-bio"><b>'+escapeHtml(p.displayName||"GRAMORA member")+'</b><p>'+escapeHtml(p.bio||"")+'</p></div><div class="ig-profile-actions"><button class="public-follow" type="button">'+(already?"Following":"Follow")+'</button></div><div class="ig-profile-grid"></div>';
    feed.replaceChildren(panel);
    panel.querySelectorAll(".stat-open").forEach(btn=>btn.addEventListener("click",()=>showFollowList(targetUid,btn.dataset.list)));
    panel.querySelector(".public-follow").addEventListener("click",async e=>{
      const btn=e.currentTarget;
      try{
        if((await getDoc(doc(db,"follows",viewer.uid+"_"+targetUid))).exists()){
          await deleteDoc(doc(db,"follows",viewer.uid+"_"+targetUid));btn.textContent="Follow";
        }else{
          await setDoc(doc(db,"follows",viewer.uid+"_"+targetUid),{followerUid:viewer.uid,followingUid:targetUid,createdAt:serverTimestamp()});btn.textContent="Following";
        }
      }catch(err){console.error("Follow action:",err);alert("Follow action failed. Check that the latest Firestore Rules are published.");}
    });
    const grid=panel.querySelector(".ig-profile-grid");
    posts.forEach(d=>{const tile=document.createElement("div");tile.className="ig-post-tile";tile.textContent=d.data().text||"";grid.append(tile);});
    if(results.slice(1).some(x=>x.status==="rejected")){
      const note=document.createElement("p");note.className="muted tiny";note.textContent="Some follower details could not be loaded. Check Firestore Rules.";panel.append(note);
    }
    if(results[0].status==="rejected"){
      const note=document.createElement("p");note.className="muted tiny";note.textContent="Posts could not be loaded. Check Firestore Rules.";panel.append(note);
    }
  }catch(err){
    console.error("Public profile load failed:",err);
    feed.textContent="Could not load profile: "+(err.code||err.message||"Please try again.");
  }
}
async function showFollowList(uid,type){
  try{
    const viewer=auth.currentUser;
    if(!viewer)return;
    const field=type==="followers"?"followingUid":"followerUid";
    const snap=await getDocs(query(collection(db,"follows"),where(field,"==",uid),limit(100)));
    const dlg=document.createElement("dialog");dlg.className="follow-list-dialog";
    const head=document.createElement("div");head.className="follow-list-head";
    const title=document.createElement("h3");title.textContent=type==="followers"?"Followers":"Following";
    const close=document.createElement("button");close.type="button";close.className="follow-list-close";close.setAttribute("aria-label","Close");close.textContent="×";close.addEventListener("click",()=>dlg.close());
    head.append(title,close);dlg.append(head);
    const search=document.createElement("input");search.type="search";search.className="follow-list-search";search.placeholder="Search";search.setAttribute("aria-label","Search "+type);dlg.append(search);
    const body=document.createElement("div");body.className="follow-list-body";dlg.append(body);
    const entries=[];
    for(const rel of snap.docs){
      const personUid=type==="followers"?rel.data().followerUid:rel.data().followingUid;
      if(!personUid)continue;
      const p=await getDoc(doc(db,"userProfiles",personUid));if(!p.exists())continue;
      const data=p.data();
      data.username=await getUsernameForUid(personUid,data);
      const isFollowing= (await getDoc(doc(db,"follows",viewer.uid+"_"+personUid))).exists();
      const row=document.createElement("div");row.className="follow-person-row";
      const profile=document.createElement("button");profile.type="button";profile.className="follow-person-profile";
      const avatar=document.createElement("span");avatar.className="follow-person-avatar";
      if(data.photoURL){const img=document.createElement("img");img.alt="";img.src=data.photoURL;avatar.append(img);}
      else avatar.textContent=(data.displayName||"G").charAt(0).toUpperCase();
      const info=document.createElement("span");info.className="follow-person-info";
      const name=document.createElement("strong");name.textContent=data.displayName||"GRAMORA member";
      const username=document.createElement("small");username.textContent="@"+(data.username||"username-not-set");
      info.append(name,username);profile.append(avatar,info);
      profile.addEventListener("click",()=>{dlg.close();loadPublicProfile(viewer,personUid);});
      row.append(profile);
      if(personUid!==viewer.uid){
        const action=document.createElement("button");action.type="button";action.className="follow-person-action"+(isFollowing?" is-following":"");
        action.textContent=isFollowing?"Following":"Follow";
        action.addEventListener("click",async()=>{
          action.disabled=true;
          try{
            const ref=doc(db,"follows",viewer.uid+"_"+personUid);
            if((await getDoc(ref)).exists()){await deleteDoc(ref);action.textContent="Follow";action.classList.remove("is-following");}
            else{await setDoc(ref,{followerUid:viewer.uid,followingUid:personUid,createdAt:serverTimestamp()});action.textContent="Following";action.classList.add("is-following");}
          }catch(error){console.error(error);alert("Could not update follow. Please try again.");}
          finally{action.disabled=false;}
        });
        row.append(action);
      }
      const searchable=((data.displayName||"")+" "+(data.username||"")).toLowerCase();
      entries.push({row,searchable});body.append(row);
    }
    if(!entries.length){const empty=document.createElement("p");empty.className="follow-list-empty";empty.textContent="No "+type+" yet.";body.append(empty);}
    search.addEventListener("input",()=>{const q=search.value.trim().toLowerCase();entries.forEach(e=>e.row.hidden=!e.searchable.includes(q));});
    document.body.append(dlg);dlg.addEventListener("close",()=>dlg.remove(),{once:true});dlg.showModal();search.focus();
  }catch(err){console.error(err);alert("Could not load list. Please check your internet connection and Firestore Rules.");}
}

async function getDocsForFeed(){
  try{
    const snapshot=await getDocs(query(collection(db,"posts"),orderBy("createdAt","desc"),limit(40)));
    if(activeView==="home")renderPosts(snapshot.docs);
  }catch(error){console.error(error);showFeedMessage("Could not load posts ("+(error.code||"unknown")+"): "+(error.message||"Check Firestore Rules."));}
}
const postForm=document.getElementById("postForm");
postForm.addEventListener("submit",async event=>{
  event.preventDefault();
  const dialog=document.getElementById("createDialog");
  const status=document.getElementById("postStatus");
  
  if(!auth?.currentUser){status.textContent="Please log in to publish a post.";return;}
  const text=document.getElementById("caption").value.trim();
  if(!text){status.textContent="Write something before sharing.";return;}
  const button=postForm.querySelector(".publish");
  button.disabled=true;button.textContent="Sharing…";status.textContent="Publishing your post…";
  try{
    const user=auth.currentUser;
    const profileSnap=await getDoc(doc(db,"userProfiles",user.uid));
    const profile=profileSnap.exists()?profileSnap.data():{};
    await addDoc(collection(db,"posts"),{uid:user.uid,displayName:profile.displayName||user.displayName||"GRAMORA member",username:profile.username||"",text,createdAt:serverTimestamp()});
    document.getElementById("caption").value="";
    status.textContent="Posted successfully!";
    dialog.close();
    activeView="home";
    document.querySelector('.mobile-nav [data-view="home"], .sidebar [data-view="home"]')?.click();
  }catch(error){
    console.error("Post publish failed:",error);
    status.textContent=error.code==="permission-denied"?"Firestore denied this post. Open Firebase Console → Firestore → Rules and publish the latest firestore.rules from GitHub.":"Post failed: "+(error.message||"Check your internet and try again.");
  }finally{button.disabled=false;button.innerHTML='Share with the community <span>↗</span>';}
});
function renderProfile(user){
  // Navigation is handled once by script.js; do not attach a second profile click handler.
}
async function loadProfileHighlights(user,panel){
  const strip=panel.querySelector(".ig-highlights");if(!strip)return;
  try{
    const snap=await getDocs(query(collection(db,"storyHighlights"),where("uid","==",user.uid)));
    snap.docs.sort((a,b)=>(b.data().createdAt?.toMillis?.()||0)-(a.data().createdAt?.toMillis?.()||0)).forEach(highlightDoc=>{
      const data=highlightDoc.data(),button=document.createElement("button");button.type="button";button.className="ig-highlight saved-highlight";
      const cover=document.createElement("span");cover.textContent=(data.coverText||data.title||"G").slice(0,2).toUpperCase();
      const label=document.createElement("small");label.textContent=data.title||"Highlight";
      button.append(cover,label);
      button.addEventListener("click",()=>{
        const stories=(data.stories||[]).map((item,index)=>({id:item.storyId||highlightDoc.id+"_"+index,data:()=>item}));
        if(!stories.length)return;
        const dialog=document.getElementById("storyViewerDialog");
        dialog._highlightStories=stories;dialog.dataset.highlightIndex="0";
        openStoryViewer(stories,stories[0].id);
      });
      strip.append(button);
    });
  }catch(error){console.error("Highlights load failed:",error);}
}
function openHighlightCreator(user){
  const dialog=document.getElementById("highlightCreateDialog"),list=document.getElementById("highlightStoryChoices"),status=document.getElementById("highlightCreateStatus");
  if(!dialog||!list)return;
  list.replaceChildren();status.textContent="";
  const own=activeStoryDocs.filter(item=>item.data().uid===user.uid);
  if(!own.length){status.textContent="Abhi aapki koi active story nahi hai. Pehle ek story lagayein."; }
  own.forEach(item=>{
    const data=item.data(),label=document.createElement("label");label.className="highlight-choice";
    const check=document.createElement("input");check.type="checkbox";check.value=item.id;
    const preview=document.createElement("span");preview.textContent=(data.text||"Story").slice(0,90);
    label.append(check,preview);list.append(label);
  });
  dialog.showModal();
}
const highlightForm=document.getElementById("highlightCreateForm");
highlightForm?.addEventListener("submit",async event=>{
  event.preventDefault();
  const user=auth?.currentUser;if(!user)return;
  const title=highlightForm.elements.title.value.trim();
  const selected=[...document.querySelectorAll("#highlightStoryChoices input:checked")].map(input=>input.value);
  const status=document.getElementById("highlightCreateStatus"),button=highlightForm.querySelector('button[type="submit"]');
  if(!title||title.length>24){status.textContent="Highlight name 1–24 characters ka rakhein.";return;}
  if(!selected.length){status.textContent="Kam se kam ek story select karein.";return;}
  if(selected.length>20){status.textContent="Ek highlight mein maximum 20 stories select kar sakte hain.";return;}
  const stories=selected.map(id=>activeStoryDocs.find(item=>item.id===id)).filter(Boolean).map(item=>{
    const d=item.data();return {storyId:item.id,uid:d.uid,displayName:d.displayName||"GRAMORA member",text:d.text||"",songTitle:d.songTitle||"",songArtist:d.songArtist||"",songUrl:d.songUrl||"",previewUrl:d.previewUrl||"",createdAt:d.createdAt||null};
  });
  if(!stories.length){status.textContent="Selected stories ab available nahi hain.";return;}
  button.disabled=true;status.textContent="Highlight save ho raha hai…";
  try{
    await addDoc(collection(db,"storyHighlights"),{uid:user.uid,title,coverText:stories[0].text.slice(0,2)||title.slice(0,2),stories,createdAt:serverTimestamp()});
    highlightForm.reset();document.getElementById("highlightCreateDialog").close();
    await loadProfilePage(user);
  }catch(error){console.error("Highlight create failed:",error);status.textContent=error.code==="permission-denied"?"Firestore Rules publish karein.":"Highlight save nahi hua. Dobara try karein.";}
  finally{button.disabled=false;}
});
document.getElementById("closeHighlightCreate")?.addEventListener("click",()=>document.getElementById("highlightCreateDialog").close());
document.getElementById("storyViewerViewToggle")?.addEventListener("click",()=>{
  const list=document.getElementById("storyViewerViewList");if(list)list.hidden=!list.hidden;
});
document.getElementById("storyViewerDialog")?.addEventListener("close",()=>{
  const dialog=document.getElementById("storyViewerDialog");dialog._highlightStories=[];dialog.dataset.highlightIndex="";
  const nav=document.getElementById("highlightStoryNav");if(nav)nav.hidden=true;
});

async function loadProfilePage(user){
  const feed=document.getElementById("feed");
  const title=document.getElementById("viewTitle");
  title.textContent="";
  feed.innerHTML='<div class="profile-loading">Loading profile…</div>';
  try{
    const snap=await getDoc(doc(db,"userProfiles",user.uid));
    const data=snap.exists()?snap.data():{};
    updateMobileProfileAvatar(data,user);
    data.username=await getUsernameForUid(user.uid,data);
    let posts=[],postsLoadError="";
    try{
      const postsSnap=await getDocs(query(collection(db,"posts"),where("uid","==",user.uid)));
      posts=postsSnap.docs.map(d=>({id:d.id,...d.data()}));
    }catch(postsError){
      console.error("Profile posts query failed:",postsError);
      postsLoadError=postsError.code==="permission-denied"?"Posts are blocked by Firestore Rules. Your profile is available, but posts cannot be shown until the posts read rule is published.":(postsError.message||"Posts could not be loaded.");
    }
    let followersCount=0,followingCount=0;
    try{
      const [followersSnap,followingSnap]=await Promise.all([
        getDocs(query(collection(db,"follows"),where("followingUid","==",user.uid),limit(100))),
        getDocs(query(collection(db,"follows"),where("followerUid","==",user.uid),limit(100)))
      ]);
      followersCount=followersSnap.size; followingCount=followingSnap.size;
    }catch(countError){console.error("Follow counts could not load:",countError);}
    const username=data.username||"gramora_user";
    const name=data.displayName||user.displayName||"GRAMORA member";
    const panel=document.createElement("section");panel.className="ig-profile";
    panel.innerHTML=`
      <div class="ig-profile-top">
        <div class="ig-avatar-wrap"><div class="ig-profile-avatar">${data.photoURL?'<img alt="Profile photo" src="'+escapeHtml(data.photoURL)+'">':escapeHtml(name.charAt(0).toUpperCase())}</div></div>
        <div class="ig-profile-summary">
          <div class="ig-profile-username"><strong>${escapeHtml(username)}</strong><button class="profile-more" type="button" aria-label="More profile options">•••</button></div>
          <div class="ig-profile-stats"><span class="profile-stat"><b>${posts.length}</b><small>posts</small></span><button class="stat-open profile-stat" data-list="followers" type="button"><b>${followersCount}</b><small>followers</small></button><button class="stat-open profile-stat" data-list="following" type="button"><b>${followingCount}</b><small>following</small></button></div>
        </div>
      </div>
      <div class="ig-profile-bio"><b>${escapeHtml(name)}</b><p>${escapeHtml(data.bio||"")}</p></div>
      <div class="ig-profile-actions"><button type="button" class="profile-edit">Edit profile</button><button type="button" class="profile-share">Share profile</button><button type="button" class="profile-add" aria-label="Discover people">♙+</button></div>
      <div class="ig-highlights"><button class="ig-highlight add-highlight" type="button" aria-label="Create a highlight"><span>＋</span><small>New</small></button></div>
      <div class="ig-profile-tabs" role="tablist"><button class="active" data-profile-tab="posts" type="button" aria-label="Posts">▦</button><button data-profile-tab="reels" type="button" aria-label="Reels">▣</button><button data-profile-tab="reposts" type="button" aria-label="Reposts">⟳</button><button data-profile-tab="tagged" type="button" aria-label="Tagged">♙</button></div>
      <div class="ig-profile-grid"></div>
      <form class="ig-edit-form" hidden><h3>Edit profile</h3><label>Display name<input name="displayName" maxlength="60"></label><label>Username<input name="username" value="${escapeHtml(username)}" minlength="3" maxlength="20" pattern="[a-zA-Z0-9_.]{3,20}" autocomplete="username" required><small>3–20 characters: letters, numbers, dot or underscore.</small></label><label>Bio<textarea name="bio" maxlength="160" rows="3"></textarea></label><button class="ig-save-profile" type="submit">Save changes</button><p class="ig-edit-status" role="status"></p></form>
    `;
    feed.replaceChildren(panel);
    const avatarWrap=panel.querySelector(".ig-avatar-wrap");
    const photoButton=document.createElement("label");photoButton.className="dp-add";photoButton.textContent="＋";photoButton.title="Add profile photo";
    const photoInput=document.createElement("input");photoInput.type="file";photoInput.accept="image/*";photoInput.className="dp-file";photoButton.append(photoInput);avatarWrap.append(photoButton);
    photoInput.addEventListener("change",async e=>{const file=e.target.files?.[0];if(!file)return;if(!file.type.startsWith("image/")){alert("Choose an image file.");return;}if(file.size>4*1024*1024){alert("Image must be under 4 MB.");e.target.value="";return;}try{const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=dataUrl;});const canvas=document.createElement("canvas");canvas.width=320;canvas.height=320;const side=Math.min(img.width,img.height);canvas.getContext("2d").drawImage(img,(img.width-side)/2,(img.height-side)/2,side,side,0,0,320,320);const photoURL=canvas.toDataURL("image/jpeg",0.68);await setDoc(doc(db,"userProfiles",user.uid),{photoURL,updatedAt:serverTimestamp()},{merge:true});panel.querySelector(".ig-profile-avatar").innerHTML='<img alt="Profile photo" src="'+photoURL+'">';}catch(err){console.error(err);alert("Profile photo could not be saved. Check Firestore Rules and image size.");}finally{e.target.value="";}});
    panel.querySelectorAll(".stat-open").forEach(btn=>btn.addEventListener("click",()=>showFollowList(user.uid,btn.dataset.list)));
    const grid=panel.querySelector(".ig-profile-grid");
    function showTab(tab){
      panel.querySelectorAll("[data-profile-tab]").forEach(b=>b.classList.toggle("active",b.dataset.profileTab===tab));
      grid.replaceChildren();
      if(tab==="posts"){
        if(postsLoadError){grid.innerHTML='<div class="ig-no-posts"><strong>!</strong><b>Posts unavailable</b><span>'+escapeHtml(postsLoadError)+'</span></div>';return;}
        if(!posts.length){grid.innerHTML='<div class="ig-no-posts"><strong>▧</strong><b>Share your first post</b><span>When you share posts, they will appear on your profile.</span></div>';return;}
        posts.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)).forEach(post=>{
          const wrap=document.createElement("div");wrap.className="ig-post-wrap";
          const tile=document.createElement("button");tile.type="button";tile.className="ig-post-tile";tile.textContent=post.text||"";
          tile.addEventListener("click",()=>{tile.classList.toggle("expanded");});
          const del=document.createElement("button");del.type="button";del.className="delete-post profile-delete-post";del.textContent="Delete";del.addEventListener("click",()=>deleteOwnPost(post.id,del,async()=>{const i=posts.findIndex(x=>x.id===post.id);if(i>=0)posts.splice(i,1);showTab("posts");}));
          wrap.append(tile,del);grid.append(wrap);
        });
      }else{
        const empty=document.createElement("div");empty.className="ig-no-posts";empty.innerHTML='<strong>▧</strong><b>'+({reels:"No Reels yet",reposts:"No reposts yet",tagged:"No tagged posts yet"}[tab])+'</b><span>This section will show your '+tab+' here.</span>';grid.append(empty);
      }
    }
    showTab("posts");
    panel.querySelectorAll("[data-profile-tab]").forEach(b=>b.addEventListener("click",()=>showTab(b.dataset.profileTab)));
    const editForm=panel.querySelector(".ig-edit-form");
    panel.querySelector(".profile-edit").addEventListener("click",()=>{
      editForm.hidden=false;
      editForm.elements.displayName.value=name;
      editForm.elements.username.value=(data.username||username||"").replace(/^@/,"");
      editForm.elements.bio.value=data.bio||"";
      const editPage=document.createElement("section");
      editPage.className="profile-edit-page";
      editPage.innerHTML='<div class="profile-edit-page-head"><button type="button" class="profile-edit-back" aria-label="Back">←</button><h2>Edit profile</h2><span></span></div>';
      editPage.append(editForm);
      feed.replaceChildren(editPage);
      editPage.querySelector(".profile-edit-back").addEventListener("click",()=>loadProfilePage(user));
      editForm.scrollIntoView({block:"start"});
    });
    panel.querySelector(".profile-share").addEventListener("click",async()=>{
      const url=location.href.split("#")[0]+"#profile";
      try{await navigator.clipboard.writeText(url);panel.querySelector(".profile-share").textContent="Link copied";}
      catch{panel.querySelector(".profile-share").textContent=url;}
    });
    panel.querySelector(".profile-add").addEventListener("click",()=>{document.querySelector('.mobile-nav [data-view="explore"], .sidebar [data-view="explore"]')?.click();});
    panel.querySelector(".add-highlight").addEventListener("click",()=>openHighlightCreator(user));
    loadProfileHighlights(user,panel);
    panel.querySelector(".profile-more").addEventListener("click",()=>alert("More profile options will be added in Settings."));
    editForm.addEventListener("submit",async event=>{
      event.preventDefault();
      const newName=editForm.elements.displayName.value.trim(),newUsername=editForm.elements.username.value.trim().toLowerCase().replace(/^@/,""),bio=editForm.elements.bio.value.trim(),status=editForm.querySelector(".ig-edit-status"),save=editForm.querySelector("button[type=submit]");
      if(!newName){status.textContent="Please enter your name.";return;}
      if(!/^[a-z0-9_.]{3,20}$/.test(newUsername)){status.textContent="Username must be 3–20 characters (letters, numbers, _ or .).";return;}
      save.disabled=true;status.textContent="Saving…";
      try{
        const profileRef=doc(db,"userProfiles",user.uid);
        const oldUsername=(data.username||"").toLowerCase();
        await runTransaction(db,async tx=>{
          const newRef=doc(db,"usernames",newUsername);
          const newSnap=await tx.get(newRef);
          if(newUsername!==oldUsername&&newSnap.exists()&&newSnap.data().uid!==user.uid)throw new Error("GRAMORA_USERNAME_TAKEN");
          if(newUsername!==oldUsername){
            const oldRef=oldUsername?doc(db,"usernames",oldUsername):null;
            if(oldRef){const oldSnap=await tx.get(oldRef);if(oldSnap.exists()&&oldSnap.data().uid===user.uid)tx.delete(oldRef);}
            tx.set(newRef,{uid:user.uid,createdAt:serverTimestamp()});
          }
          tx.set(profileRef,{uid:user.uid,displayName:newName,username:newUsername,bio,updatedAt:serverTimestamp()},{merge:true});
        });
        await updateProfile(auth.currentUser,{displayName:newName});
        data.displayName=newName;data.username=newUsername;data.bio=bio;
        panel.querySelector(".ig-profile-username strong").textContent="@"+newUsername;
        panel.querySelector(".ig-profile-bio").innerHTML="<b>"+escapeHtml(newName)+"</b><p>"+escapeHtml(bio)+"</p>";
        status.textContent="Profile updated successfully.";
        await loadProfilePage(user);
      }catch(error){
        console.error("Profile update failed:",error);
        status.textContent=error.message==="GRAMORA_USERNAME_TAKEN"?"This username is already taken. Choose another.":error.code==="permission-denied"?"Firebase Rules need updating before usernames can be edited.":"Could not update profile: "+(error.message||"Try again.");
      }finally{save.disabled=false;}
    });
  }catch(error){
    console.error("Profile load error:",error);
    feed.innerHTML='<p class="muted">Could not load profile: '+escapeHtml(error.message||"Please try again.")+'</p>';
  }
}
function escapeHtml(value){
  return String(value||"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}

// Settings center
const settingsDialog=document.getElementById("settingsDialog");
document.getElementById("closeCreate")?.addEventListener("click",()=>document.getElementById("createDialog").close());
document.getElementById("settingsBtn")?.addEventListener("click",()=>settingsDialog.showModal());
document.getElementById("addAccountBtn")?.addEventListener("click",()=>{
  document.getElementById("addAccountStatus").textContent="";
  document.getElementById("addAccountDialog")?.showModal();
});
document.getElementById("closeAddAccount")?.addEventListener("click",()=>{
  document.getElementById("addAccountDialog")?.close();
});
function setAddAccountMode(mode){
  const login=mode==="login";
  document.getElementById("accountLoginTab").classList.toggle("active",login);
  document.getElementById("accountSignupTab").classList.toggle("active",!login);
  document.getElementById("addAccountForm").hidden=!login;
  document.getElementById("createAddedAccountForm").hidden=login;
  document.getElementById("addAccountStatus").textContent="";
}
document.getElementById("accountLoginTab")?.addEventListener("click",()=>setAddAccountMode("login"));
document.getElementById("accountSignupTab")?.addEventListener("click",()=>setAddAccountMode("signup"));
document.getElementById("addAccountForm")?.addEventListener("submit",async event=>{
  event.preventDefault();
  const email=document.getElementById("addAccountEmail").value.trim().toLowerCase();
  const password=document.getElementById("addAccountPassword").value;
  const status=document.getElementById("addAccountStatus");
  const button=event.currentTarget.querySelector('button[type="submit"]');
  if(auth?.currentUser?.email?.toLowerCase()===email){status.textContent="Ye account pehle se active hai.";return;}
  button.disabled=true;button.textContent="Adding account…";status.textContent="Signing in securely…";
  try{
    let record=savedAccounts.find(x=>x.email?.toLowerCase()===email);
    let instance;
    if(record){
      instance=getAccountInstance(record.uid);
      if(!instance.auth.currentUser) await signInWithEmailAndPassword(instance.auth,email,password);
    }else{
      const appName="gramora-login-"+email.replace(/[^a-z0-9]/g,"-").slice(0,45);
      const secondaryApp=getApps().find(x=>x.name===appName)||initializeApp(firebaseConfig,appName);
      const secondaryAuth=getAuth(secondaryApp),secondaryDb=getFirestore(secondaryApp);
      const credential=await signInWithEmailAndPassword(secondaryAuth,email,password);
      instance={app:secondaryApp,auth:secondaryAuth,db:secondaryDb};
      accountInstances.set(credential.user.uid,instance);
      rememberAccount(credential.user,appName);
    }
    activateAccount(instance);
    document.getElementById("addAccountDialog").close();
    document.getElementById("settingsDialog")?.close();
    event.currentTarget.reset();
  }catch(error){
    console.error("Add account login failed:",error);
    status.textContent=authError(error.code);
  }finally{button.disabled=false;button.innerHTML='Log in and add account <span>↗</span>';}
});
document.getElementById("createAddedAccountForm")?.addEventListener("submit",async event=>{
  event.preventDefault();
  const form=event.currentTarget;
  const name=document.getElementById("newAccountName").value.trim();
  const username=document.getElementById("newAccountUsername").value.trim().toLowerCase().replace(/^@/,"");
  const email=document.getElementById("newAccountEmail").value.trim().toLowerCase();
  const password=document.getElementById("newAccountPassword").value;
  const status=document.getElementById("addAccountStatus");
  const button=form.querySelector('button[type="submit"]');
  if(!/^[a-z0-9_.]{3,20}$/.test(username)){status.textContent="Username 3–20 characters ka hona chahiye (letters, numbers, _ ya .).";return;}
  if(savedAccounts.some(x=>x.email?.toLowerCase()===email)){status.textContent="Ye account pehle se add hai. Log in tab se switch karein.";return;}
  button.disabled=true;button.textContent="Creating account…";status.textContent="Naya account banaya ja raha hai…";
  try{
    const appName="gramora-new-"+email.replace(/[^a-z0-9]/g,"-").slice(0,45);
    const secondaryApp=getApps().find(x=>x.name===appName)||initializeApp(firebaseConfig,appName);
    const secondaryAuth=getAuth(secondaryApp),secondaryDb=getFirestore(secondaryApp);
    const credential=await createUserWithEmailAndPassword(secondaryAuth,email,password);
    await updateProfile(credential.user,{displayName:name});
    const profileRef=doc(secondaryDb,"userProfiles",credential.user.uid);
    const usernameRef=doc(secondaryDb,"usernames",username);
    await runTransaction(secondaryDb,async tx=>{
      const existing=await tx.get(usernameRef);
      if(existing.exists())throw new Error("GRAMORA_USERNAME_TAKEN");
      tx.set(usernameRef,{uid:credential.user.uid,createdAt:serverTimestamp()});
      tx.set(profileRef,{uid:credential.user.uid,displayName:name,username,email,bio:"",photoURL:"",followersCount:0,followingCount:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    });
    const instance={app:secondaryApp,auth:secondaryAuth,db:secondaryDb};
    accountInstances.set(credential.user.uid,instance);
    rememberAccount(credential.user,appName);
    activateAccount(instance);
    document.getElementById("addAccountDialog").close();
    document.getElementById("settingsDialog")?.close();
    form.reset();
  }catch(error){
    console.error("Create added account failed:",error);
    status.textContent=error.message==="GRAMORA_USERNAME_TAKEN"?"Ye username pehle se kisi ne le rakha hai. Dusra username chunein.":authError(error.code);
  }finally{button.disabled=false;button.innerHTML='Create account and add <span>↗</span>';}
});

document.getElementById("closeSettings")?.addEventListener("click",()=>settingsDialog.close());
document.querySelectorAll(".settings-tab").forEach(tab=>tab.addEventListener("click",()=>{
  document.querySelectorAll(".settings-tab").forEach(x=>x.classList.toggle("active",x===tab));
  document.querySelectorAll(".settings-panel").forEach(panel=>panel.hidden=panel.dataset.panel!==tab.dataset.settings);
}));
document.getElementById("settingsLogout")?.addEventListener("click",async()=>{
  const currentUid=auth?.currentUser?.uid;
  try{
    await signOut(auth);
    savedAccounts=savedAccounts.filter(x=>x.uid!==currentUid);
    saveAccountList();
    const next=savedAccounts[0];
    if(next){
      const instance=next.appName==="[DEFAULT]"?{app,auth:getAuth(app),db:getFirestore(app)}:getAccountInstance(next.uid);
      activateAccount(instance);
    }else{gate.hidden=false;}
    renderAccountSwitcher();
    settingsDialog.close();
  }catch(error){document.getElementById("settingsStatus").textContent=authError(error.code);}
});
document.getElementById("settingsPassword")?.addEventListener("click",async()=>{
  const email=auth?.currentUser?.email;
  if(!email){document.getElementById("settingsStatus").textContent="No account email found.";return;}
  try{await sendPasswordResetEmail(auth,email);document.getElementById("settingsStatus").textContent="Password reset link sent to "+email;}
  catch(error){document.getElementById("settingsStatus").textContent=authError(error.code);}
});
document.getElementById("settingsProfile")?.addEventListener("click",()=>{
  settingsDialog.close();document.querySelector('.mobile-nav [data-view="profile"], .sidebar [data-view="profile"]')?.click();
});
document.getElementById("settingsTheme")?.addEventListener("click",()=>document.getElementById("themeBtn")?.click());

function authError(code){
  const messages={
    "auth/email-already-in-use":"This email already has an account. Please log in.",
    "auth/invalid-email":"Please enter a valid email address.",
    "auth/weak-password":"Choose a stronger password (at least 6 characters).",
    "auth/invalid-credential":"Email or password is incorrect.",
    "auth/user-not-found":"No account found with this email.",
    "auth/network-request-failed":"Network error. Check your internet connection.",
    "auth/too-many-requests":"Too many attempts. Please wait and try again.",
    "auth/operation-not-allowed":"Email/password sign-in is not enabled in Firebase yet.",
    "permission-denied":"Firestore denied access. Publish the GRAMORA Firestore rules."
  };
  return messages[code]||"Something went wrong. Please try again.";
}
