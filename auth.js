import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, updateProfile, sendPasswordResetEmail, signOut } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, runTransaction, serverTimestamp, Timestamp, collection, addDoc, query, orderBy, limit, onSnapshot, getDocs, where, deleteDoc, updateDoc, startAfter, increment, getCountFromServer } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
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
let activeNotificationUnsubscribe=null;
let notificationToastTimer=null;
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
  try{localStorage.setItem("gramoraActiveAccountUid",user.uid);}catch(error){}
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

let activePresenceCleanup=null;
function startGramoraPresence(user,selectedDb){
  if(activePresenceCleanup)activePresenceCleanup();
  const presenceRef=doc(selectedDb,"userPresence",user.uid);
  const writePresence=online=>setDoc(presenceRef,{uid:user.uid,online:!!online,lastSeen:serverTimestamp()},{merge:true}).catch(error=>console.warn("Presence update failed:",error));
  const isAvailable=()=>!document.hidden&&navigator.onLine;
  const onVisibility=()=>writePresence(isAvailable());
  const onNetwork=()=>writePresence(isAvailable());
  const onPageHide=()=>writePresence(false);
  writePresence(isAvailable());
  const heartbeat=setInterval(()=>writePresence(isAvailable()),30000);
  document.addEventListener("visibilitychange",onVisibility);
  window.addEventListener("online",onNetwork);
  window.addEventListener("offline",onNetwork);
  window.addEventListener("pagehide",onPageHide);
  activePresenceCleanup=()=>{clearInterval(heartbeat);document.removeEventListener("visibilitychange",onVisibility);window.removeEventListener("online",onNetwork);window.removeEventListener("offline",onNetwork);window.removeEventListener("pagehide",onPageHide);writePresence(false);activePresenceCleanup=null;};
}
function activateAccount(instance){
  if(activeAuthUnsubscribe) activeAuthUnsubscribe();
  if(activeFeedUnsubscribe){activeFeedUnsubscribe();activeFeedUnsubscribe=null;}
  if(activeNotificationUnsubscribe){activeNotificationUnsubscribe();activeNotificationUnsubscribe=null;}
  if(activePresenceCleanup){activePresenceCleanup();activePresenceCleanup=null;}
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
      startGramoraPresence(user,selectedDb);
      if(accountLabel) accountLabel.textContent=user.displayName||user.email||"Account";
      try{
        await ensureProfile(user);
        if(auth!==selectedAuth || auth.currentUser?.uid!==user.uid)return;
        const navProfileSnap=await getDoc(doc(selectedDb,"userProfiles",user.uid));
        updateMobileProfileAvatar(navProfileSnap.exists()?navProfileSnap.data():{},user);
        startPostsFeed(user);
        startStoriesFeed(user);
        refreshNotificationBadge();
        startLiveNotificationListener(user,selectedDb);
        // Keep the current screen open, but reload it using the newly active account.
        if(activeView==="profile") await loadProfilePage(user);
        else if(activeView==="explore") await loadExplorePage(user);
        else if(activeView==="home") await getDocsForFeed();
        else if(activeView==="saved") await loadSavedPosts();
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
        localStorage.setItem("gramoraActiveAccountUid",record.uid);
        activateAccount(instance);
        closeSettingsDrawer();
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

// IN-APP NOTIFICATIONS
async function createGramoraNotification(toUid,type,message,extra={}){
  const user=auth?.currentUser;
  if(!user||!toUid||toUid===user.uid)return;
  try{
    const profileSnap=await getDoc(doc(db,"userProfiles",user.uid));
    const profile=profileSnap.exists()?profileSnap.data():{};
    await addDoc(collection(db,"notifications"),{
      toUid,fromUid:user.uid,
      fromName:profile.displayName||user.displayName||"GRAMORA member",
      type,message,
      postId:extra.postId||"",
      storyId:extra.storyId||"",
      createdAt:serverTimestamp(),
      read:false
    });
    refreshNotificationBadge();
  }catch(error){console.warn("Notification could not be saved:",error);}
}
function showGramoraNotificationToast(item){
  const old=document.getElementById("gramoraLiveToast");
  if(old)old.remove();
  if(notificationToastTimer)clearTimeout(notificationToastTimer);
  const toast=document.createElement("button");
  toast.type="button";toast.id="gramoraLiveToast";toast.className="gramora-live-toast";
  const avatar=document.createElement("span");avatar.className="gramora-live-toast-avatar";
  avatar.textContent=(item.fromName||"G").trim().charAt(0).toUpperCase();
  const copy=document.createElement("span");copy.className="gramora-live-toast-copy";
  const heading=document.createElement("b");heading.textContent="GRAMORA";
  const message=document.createElement("span");message.textContent=(item.fromName||"Someone")+" "+(item.message||"interacted with you.");
  const time=document.createElement("small");time.textContent="now";
  copy.append(heading,message,time);
  const close=document.createElement("span");close.className="gramora-live-toast-close";close.textContent="×";close.setAttribute("aria-hidden","true");
  toast.append(avatar,copy,close);
  toast.addEventListener("click",async()=>{
    toast.remove();if(notificationToastTimer)clearTimeout(notificationToastTimer);
    if(item.id&&!item.read){try{await updateDoc(doc(db,"notifications",item.id),{read:true});item.read=true;refreshNotificationBadge();}catch(error){console.warn("Toast notification read status failed:",error);}}
    if(item.postId){
      try{const postSnap=await getDoc(doc(db,"posts",item.postId));if(postSnap.exists())openPostDetail({id:postSnap.id,...postSnap.data()},false);else await openPersonProfile(item.fromUid);}
      catch(error){console.warn("Could not open notification target:",error);}
    }else if(item.storyId){
      const story=activeStoryDocs.find(x=>x.id===item.storyId);
      if(story)openStoryViewer(activeStoryDocs,story.id);else await openPersonProfile(item.fromUid);
    }else if(item.fromUid)await openPersonProfile(item.fromUid);
  });
  document.body.append(toast);
  requestAnimationFrame(()=>toast.classList.add("visible"));
  notificationToastTimer=setTimeout(()=>{toast.classList.remove("visible");setTimeout(()=>toast.remove(),250);},5200);
}
function startLiveNotificationListener(user,selectedDb){
  if(activeNotificationUnsubscribe)activeNotificationUnsubscribe();
  let firstSnapshot=true;
  const liveQuery=query(collection(selectedDb,"notifications"),where("toUid","==",user.uid),limit(100));
  activeNotificationUnsubscribe=onSnapshot(liveQuery,snapshot=>{
    if(firstSnapshot){firstSnapshot=false;return;}
    snapshot.docChanges().forEach(change=>{
      if(change.type==="added"){
        const item={id:change.doc.id,...change.doc.data()};
        if(item.fromUid!==user.uid)showGramoraNotificationToast(item);
      }
    });
    refreshNotificationBadge();
  },error=>console.warn("Live notifications unavailable:",error));
}
async function refreshNotificationBadge(){
  const button=document.getElementById("notificationBtn"),user=auth?.currentUser;
  if(!button||!user)return;
  try{
    const snap=await getDocs(query(collection(db,"notifications"),where("toUid","==",user.uid),limit(100)));
    const unread=snap.docs.filter(item=>item.data().read!==true).length;
    button.innerHTML=unread?'<span class="notification-badge">'+(unread>99?"99+":unread)+'</span>':"";
    button.setAttribute("aria-label",unread?unread+" unread notifications":"Notifications");
  }catch(error){console.warn("Notification count unavailable:",error);}
}
async function openGramoraNotifications(){
  const user=auth?.currentUser;if(!user)return;
  const dialog=document.createElement("dialog");dialog.className="gramora-notifications-dialog";
  const header=document.createElement("div");header.className="gramora-notifications-head";
  const title=document.createElement("h2");title.textContent="Notifications";
  const close=document.createElement("button");close.type="button";close.className="notification-back-btn";close.textContent="‹";close.setAttribute("aria-label","Back");close.title="Back";close.addEventListener("click",()=>dialog.close());
  header.append(title,close);
  const list=document.createElement("div");list.className="gramora-notifications-list";list.textContent="Loading notifications…";
  dialog.append(header,list);document.body.append(dialog);dialog.addEventListener("close",()=>dialog.remove(),{once:true});dialog.showModal();
  try{
    const snap=await getDocs(query(collection(db,"notifications"),where("toUid","==",user.uid),limit(100)));
    // Opening the notification centre marks every notification currently shown as read.
    const readStates=await Promise.all(snap.docs.map(async notificationDoc=>{
      const data=notificationDoc.data();
      if(data.read===true)return true;
      try{await updateDoc(doc(db,"notifications",notificationDoc.id),{read:true});return true;}
      catch(error){console.warn("Could not mark notification as read:",notificationDoc.id,error);return false;}
    }));
    const items=snap.docs.map((notificationDoc,index)=>({id:notificationDoc.id,...notificationDoc.data(),read:readStates[index]||notificationDoc.data().read===true})).sort((x,y)=>(y.createdAt?.toMillis?.()||0)-(x.createdAt?.toMillis?.()||0));
    refreshNotificationBadge();
    list.replaceChildren();
    if(!items.length){list.textContent="You’re all caught up. No notifications yet.";return;}
    for(const item of items){
      const row=document.createElement("div");row.className="gramora-notification"+(item.read?"":" unread");row.setAttribute("role","button");row.tabIndex=0;
      const profileButton=document.createElement("button");profileButton.type="button";profileButton.className="gramora-notification-profile";
      const avatar=document.createElement("span");avatar.className="gramora-notification-avatar";avatar.textContent=(item.fromName||"G").trim().charAt(0).toUpperCase();
      const body=document.createElement("span");body.className="gramora-notification-copy";
      const message=document.createElement("span");message.textContent=(item.fromName||"Someone")+" "+(item.message||"interacted with you.");
      const time=document.createElement("small");const stamp=item.createdAt?.toDate?.();time.textContent=stamp?stamp.toLocaleString():"";
      body.append(message,time);profileButton.append(avatar,body);
      profileButton.addEventListener("click",async event=>{event.stopPropagation();if(!item.fromUid)return;try{if(!item.read)await updateDoc(doc(db,"notifications",item.id),{read:true});}catch(error){console.warn("Notification read status failed:",error);}dialog.close();refreshNotificationBadge();await openPersonProfile(item.fromUid);});
      row.append(profileButton);
      if(item.type==="follow_request"&&item.fromUid){
        const actions=document.createElement("div");actions.className="follow-request-actions notification-follow-actions";
        const accept=document.createElement("button");accept.type="button";accept.className="blocked-unblock";accept.textContent="Confirm";
        const decline=document.createElement("button");decline.type="button";decline.className="blocked-refresh";decline.textContent="Delete";
        accept.addEventListener("click",async event=>{
          event.stopPropagation();accept.disabled=true;decline.disabled=true;accept.textContent="…";
          let confirmStep="block check";
          try{
            const status=await getBlockStatus(user.uid,item.fromUid);
            if(status.blockedByMe||status.blockedMe)throw new Error("Blocked accounts cannot follow each other.");
            const followRef=doc(db,"follows",item.fromUid+"_"+user.uid);
            const requestRef=doc(db,"followRequests",item.fromUid+"_"+user.uid);
            confirmStep="follow record check";
            const [existingFollow,existingRequest]=await Promise.all([getDoc(followRef),getDoc(requestRef)]);
            if(!existingFollow.exists()){
              if(!existingRequest.exists())throw new Error("This follow request is no longer available. Refresh Notifications.");
              confirmStep="follow record create";
              await setDoc(followRef,{followerUid:item.fromUid,followingUid:user.uid,createdAt:serverTimestamp()});
            }
            confirmStep="follow request delete";
            if(existingRequest.exists())await deleteDoc(requestRef);
            confirmStep="notification mark as read";
            await updateDoc(doc(db,"notifications",item.id),{read:true});
            row.remove();refreshNotificationBadge();if(!list.querySelector(".gramora-notification"))list.textContent="You’re all caught up. No notifications yet.";
          }catch(error){console.error("Follow request confirmation failed at "+confirmStep+":",error);accept.disabled=false;decline.disabled=false;accept.textContent="Confirm";alert("Confirm failed at: "+confirmStep+" ("+(error.code||"error")+"). "+(error.message||"Dobara try karein."));}
        });
        decline.addEventListener("click",async event=>{
          event.stopPropagation();decline.disabled=true;
          try{await deleteDoc(doc(db,"followRequests",item.fromUid+"_"+user.uid));await deleteDoc(doc(db,"notifications",item.id));row.remove();refreshNotificationBadge();if(!list.querySelector(".gramora-notification"))list.textContent="You’re all caught up. No notifications yet.";}
          catch(error){console.error("Follow request delete failed:",error);decline.disabled=false;alert("Request delete nahi hui. Latest Firestore Rules check karein.");}
        });
        actions.append(accept,decline);row.append(actions);
      }
      if(!item.read){const dot=document.createElement("i");dot.className="notification-unread-dot";row.append(dot);}
      const remove=document.createElement("button");remove.type="button";remove.className="notification-delete-btn";remove.textContent="Delete";remove.setAttribute("aria-label","Delete notification");
      remove.addEventListener("click",async event=>{
        event.stopPropagation();remove.disabled=true;remove.textContent="…";
        try{await deleteDoc(doc(db,"notifications",item.id));row.remove();refreshNotificationBadge();if(!list.querySelector(".gramora-notification"))list.textContent="You’re all caught up. No notifications yet.";}
        catch(error){console.error("Notification delete failed:",error);remove.disabled=false;remove.textContent="Delete";alert(error.code==="permission-denied"?"Publish the latest Firestore Rules to delete notifications.":"Notification delete nahi hui. Dobara try karein.");}
      });
      row.append(remove);
      const openItem=async()=>{
        try{if(!item.read)await updateDoc(doc(db,"notifications",item.id),{read:true});}catch(error){console.warn("Notification read status failed:",error);}
        dialog.close();refreshNotificationBadge();
        if(item.postId){
          const postSnap=await getDoc(doc(db,"posts",item.postId));
          if(postSnap.exists())openPostDetail({id:postSnap.id,...postSnap.data()},false);
          else showMessage("This post is no longer available.");
        }else if(item.storyId){
          const story=activeStoryDocs.find(x=>x.id===item.storyId);
          if(story)openStoryViewer(activeStoryDocs,story.id);
          else showMessage("This story has expired.");
        }else if(item.fromUid)await openPersonProfile(item.fromUid);
      };
      row.addEventListener("click",openItem);row.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();openItem();}});
      list.append(row);
    }
    refreshNotificationBadge();
  }catch(error){
    console.error("Notifications load failed:",error);
    list.textContent=error.code==="permission-denied"?"Notifications ke liye latest Firestore Rules publish karein.":"Notifications load nahi hui. Dobara try karein.";
  }
}
document.getElementById("notificationBtn")?.addEventListener("click",openGramoraNotifications);

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


if(auth){
  const preferredUid=(()=>{try{return localStorage.getItem("gramoraActiveAccountUid")||"";}catch(error){return "";}})();
  const preferredRecord=savedAccounts.find(record=>record.uid===preferredUid);
  const startupInstance=preferredRecord
    ? (preferredRecord.appName==="[DEFAULT]"?{app,auth:getAuth(app),db:getFirestore(app)}:getAccountInstance(preferredRecord.uid))
    : {app,auth,db};
  activateAccount(startupInstance);
}else { document.body.classList.remove("auth-pending"); gate.hidden=false; document.body.classList.add("auth-required"); }


let activeStoriesUnsubscribe=null;
let activeStoryDocs=[];
const storyProfileCache=new Map();
function storySeenKey(id){return "gramora-story-seen-"+(auth?.currentUser?.uid||"guest")+"-"+id;}
function storyWasSeen(id){try{return localStorage.getItem(storySeenKey(id))==="1";}catch(error){return false;}}
function markStorySeen(id){try{localStorage.setItem(storySeenKey(id),"1");}catch(error){}}
function startStoriesFeed(user){
  if(activeStoriesUnsubscribe)activeStoriesUnsubscribe();
  let docs=[],offs=[],cancelled=false;
  activeStoriesUnsubscribe=()=>{cancelled=true;offs.forEach(off=>off());};
  getVisibleContentUids(user).then(uids=>{
    if(cancelled)return;
    if(!uids.length){activeStoryDocs=[];renderStories([]);return;}
    uids.forEach(uid=>offs.push(onSnapshot(query(collection(db,"stories"),where("uid","==",uid),limit(100)),snapshot=>{
      docs=docs.filter(item=>item.data().uid!==uid).concat(snapshot.docs);
      activeStoryDocs=docs.filter(item=>{const expiry=item.data().expiresAt;return expiry?.toMillis?expiry.toMillis()>Date.now():false;});
      activeStoryDocs.sort((a,b)=>(b.data().createdAt?.toMillis?.()||0)-(a.data().createdAt?.toMillis?.()||0));
      renderStories(activeStoryDocs);
    },error=>{console.error("Stories feed error:",error);const hint=document.getElementById("storyCreateStatus");if(hint)hint.textContent="Stories load nahi hui. Latest Firestore Rules publish karein.";})));
  }).catch(error=>console.error("Stories feed setup failed:",error));
}
async function getStoryProfile(uid){
  if(storyProfileCache.has(uid))return storyProfileCache.get(uid);
  try{
    const snap=await getDoc(doc(db,"userProfiles",uid));
    const profile=snap.exists()?snap.data():{};
    storyProfileCache.set(uid,profile);return profile;
  }catch(error){return {};}
}
function bindAvatarLongPress(element,uid,initialProfile={}){
  if(!element||!uid||element.dataset.longPressBound==="1")return;
  element.dataset.longPressBound="1";
  let pressTimer=null,openedByHold=false;
  const cancel=()=>{if(pressTimer){clearTimeout(pressTimer);pressTimer=null;}};
  const showActions=async()=>{
    openedByHold=true;
    let profile=initialProfile||{};
    try{if(!profile.photoURL||!profile.displayName){const snap=await getDoc(doc(db,"userProfiles",uid));if(snap.exists())profile={...profile,...snap.data()};}}catch(error){console.warn("Avatar profile unavailable:",error);}
    const story=activeStoryDocs.find(item=>item.data().uid===uid);
    const dialog=document.createElement("dialog");dialog.className="dp-action-dialog";
    const heading=document.createElement("h3");heading.textContent=profile.displayName||"Profile";
    const actions=document.createElement("div");actions.className="dp-action-buttons";
    if(story){
      const viewStory=document.createElement("button");viewStory.type="button";viewStory.textContent="◉  View Story";
      viewStory.addEventListener("click",()=>{dialog.close();openStoryViewer(activeStoryDocs,story.id);});
      actions.append(viewStory);
    }
    const viewDp=document.createElement("button");viewDp.type="button";viewDp.textContent="◎  View DP";
    viewDp.addEventListener("click",()=>{
      dialog.close();
      const viewer=document.createElement("dialog");viewer.className="dp-viewer-dialog";
      const close=document.createElement("button");close.type="button";close.className="dp-viewer-close";close.textContent="×";close.addEventListener("click",()=>viewer.close());
      const imageWrap=document.createElement("div");imageWrap.className="dp-viewer-image";
      if(profile.photoURL){const img=document.createElement("img");img.src=profile.photoURL;img.alt=(profile.displayName||"User")+" profile photo";imageWrap.append(img);}
      else{const initial=document.createElement("span");initial.textContent=(profile.displayName||"G").trim().charAt(0).toUpperCase();imageWrap.append(initial);}
      viewer.append(close,imageWrap);document.body.append(viewer);viewer.addEventListener("close",()=>viewer.remove(),{once:true});viewer.showModal();
    });
    actions.append(viewDp);
    const cancelButton=document.createElement("button");cancelButton.type="button";cancelButton.className="dp-action-cancel";cancelButton.textContent="Cancel";cancelButton.addEventListener("click",()=>dialog.close());
    dialog.append(heading,actions,cancelButton);document.body.append(dialog);dialog.addEventListener("close",()=>dialog.remove(),{once:true});dialog.showModal();
  };
  element.addEventListener("pointerdown",event=>{if(event.pointerType==="mouse"&&event.button!==0)return;openedByHold=false;cancel();pressTimer=setTimeout(()=>{pressTimer=null;showActions();},550);});
  ["pointerup","pointerleave","pointercancel"].forEach(type=>element.addEventListener(type,cancel));
  element.addEventListener("click",event=>{if(openedByHold){event.preventDefault();event.stopPropagation();openedByHold=false;}},true);
  element.addEventListener("contextmenu",event=>{event.preventDefault();cancel();showActions();});
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
  const current=auth?.currentUser;
  const ownStories=docs.filter(item=>item.data().uid===current?.uid)
    .sort((a,b)=>(a.data().createdAt?.toMillis?.()||0)-(b.data().createdAt?.toMillis?.()||0));
  const create=document.createElement("button");create.className="story your-story";create.type="button";
  const createRing=document.createElement("span");createRing.className="story-ring story-add-ring";
  const currentProfile=storyProfileCache.get(current?.uid)||{};
  makeStoryAvatar(createRing,currentProfile,currentProfile.displayName||current?.displayName||"G");
  const plus=document.createElement("i");plus.textContent="＋";plus.setAttribute("aria-label","Add story");createRing.append(plus);
  const createLabel=document.createElement("small");createLabel.textContent="Your story";
  create.append(createRing,createLabel);
  const openCreator=event=>{
    event?.stopPropagation();
    storyEditingId=null;storyForm?.reset();
    setStoryEditingMode(true);if(storyCharCount)storyCharCount.textContent="0";
    document.getElementById("storyCreateDialog").querySelector("h2").textContent="Create a text story";
    document.querySelector("#storyForm button[type=submit]").textContent="Share story";
    document.getElementById("storyCreateDialog")?.showModal();
  };
  plus.addEventListener("click",openCreator);
  create.addEventListener("click",()=>{
    if(ownStories.length)openStoryViewer(ownStories,ownStories[0].id);
    else openCreator();
  });
  strip.append(create);
  const latestByUser=new Map();
  docs.forEach(storyDoc=>{
    const uid=storyDoc.data().uid;
    if(uid&&uid!==current?.uid&&!latestByUser.has(uid))latestByUser.set(uid,storyDoc);
  });
  latestByUser.forEach((storyDoc,uid)=>{
    const data=storyDoc.data(),name=data.displayName||"GRAMORA member";
    const item=document.createElement("button");item.type="button";item.className="story";
    const userStories=docs.filter(entry=>entry.data().uid===uid)
      .sort((a,b)=>(a.data().createdAt?.toMillis?.()||0)-(b.data().createdAt?.toMillis?.()||0));
    const ring=document.createElement("span");ring.className="story-ring story-user-ring "+(userStories.every(entry=>storyWasSeen(entry.id))?"story-seen":"story-unseen");
    const label=document.createElement("small");label.textContent=name;
    const profile=storyProfileCache.get(uid)||{};
    makeStoryAvatar(ring,profile,name);
    item.append(ring,label);item.addEventListener("click",()=>openStoryViewer(userStories,userStories[0]?.id));
    strip.append(item);
    if(!storyProfileCache.has(uid))getStoryProfile(uid).then(p=>{if(ring.isConnected)makeStoryAvatar(ring,p,name);});
  });
  if(current&&!storyProfileCache.has(current.uid))getStoryProfile(current.uid).then(p=>{
    if(createRing.isConnected){
      makeStoryAvatar(createRing,p,p.displayName||current.displayName||"G");
      if(createRing.isConnected&&!createRing.querySelector("i")){const plusIcon=document.createElement("i");plusIcon.textContent="＋";plusIcon.setAttribute("aria-label","Add story");plusIcon.addEventListener("click",openCreator);createRing.append(plusIcon);}
    }
  });
}
async function recordStoryView(storyId,storyData){
  const user=auth?.currentUser;if(!user||user.uid===storyData.uid)return;
  try{
    const ref=doc(db,"storyViews",storyId+"_"+user.uid);
    const profileSnap=await getDoc(doc(db,"userProfiles",user.uid));
    const profile=profileSnap.exists()?profileSnap.data():{};
    const viewData={storyId,storyUid:storyData.uid,uid:user.uid,displayName:profile.displayName||user.displayName||"GRAMORA member",createdAt:serverTimestamp()};
    await setDoc(ref,viewData);
  }catch(error){console.error("Story view could not be recorded:",error);}
}
let storyViewerTimer=null,storyViewerStartedAt=0,storyViewerDuration=7000,storyViewerSequence=[],storyViewerIndex=0,storyViewerPaused=false;
function stopStoryViewerTimer(){
  if(storyViewerTimer){clearInterval(storyViewerTimer);storyViewerTimer=null;}
}
function renderStoryViewerProgress(){
  const wrap=document.getElementById("storyViewerProgress");if(!wrap)return;
  wrap.replaceChildren();
  storyViewerSequence.forEach((item,index)=>{
    const track=document.createElement("span");track.className="gramora-viewer-progress-track";
    const fill=document.createElement("i");fill.className="gramora-viewer-progress-fill";
    if(index<storyViewerIndex)fill.style.width="100%";
    track.append(fill);wrap.append(track);
  });
}
function startStoryViewerTimer(){
  stopStoryViewerTimer();
  const audio=document.getElementById("storyViewerAudio");
  storyViewerDuration=audio&&!audio.hidden&&audio.src?15000:7000;
  storyViewerStartedAt=Date.now();storyViewerPaused=false;
  storyViewerTimer=setInterval(()=>{
    if(storyViewerPaused)return;
    const elapsed=Date.now()-storyViewerStartedAt;
    const pct=Math.min(100,elapsed/storyViewerDuration*100);
    const fill=document.querySelectorAll("#storyViewerProgress .gramora-viewer-progress-fill")[storyViewerIndex];
    if(fill)fill.style.width=pct+"%";
    if(pct>=100){stopStoryViewerTimer();navigateStoryViewer(1);}
  },50);
}
function navigateStoryViewer(direction){
  if(!storyViewerSequence.length)return;
  const next=storyViewerIndex+direction;
  if(next<0){storyViewerIndex=0;return;}
  if(next>=storyViewerSequence.length){stopStoryViewerTimer();document.getElementById("storyViewerDialog")?.close();return;}
  openStoryViewer(storyViewerSequence,storyViewerSequence[next].id);
}
const storyViewerStage=document.getElementById("storyViewerStage");
let storyViewerTouchX=0,storyViewerTouchY=0;
storyViewerStage?.addEventListener("touchstart",event=>{
  const touch=event.changedTouches[0];storyViewerTouchX=touch.clientX;storyViewerTouchY=touch.clientY;
},{passive:true});
storyViewerStage?.addEventListener("touchend",event=>{
  const touch=event.changedTouches[0],dx=touch.clientX-storyViewerTouchX,dy=touch.clientY-storyViewerTouchY;
  const activitySheet=document.getElementById("storyActivitySheet");
  if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)){navigateStoryViewer(dx<0?1:-1);}
  else if(dy<-65){
    const current=storyViewerSequence[storyViewerIndex],data=current?.data?.();
    if(data&&data.uid===auth?.currentUser?.uid&&!document.getElementById("storyViewerDialog")?._highlightStories?.length)openStoryActivitySheet(current.id,data.uid);
  }else if(dy>75){
    if(activitySheet&&!activitySheet.hidden)closeStoryActivitySheet();
    else document.getElementById("storyViewerDialog")?.close();
  }
},{passive:true});
document.getElementById("storyActivityClose")?.addEventListener("click",closeStoryActivitySheet);
let storyActivityTouchY=0;
const storyActivitySheet=document.getElementById("storyActivitySheet");
storyActivitySheet?.addEventListener("touchstart",event=>{storyActivityTouchY=event.changedTouches[0].clientY;},{passive:true});
storyActivitySheet?.addEventListener("touchend",event=>{if(event.changedTouches[0].clientY-storyActivityTouchY>65)closeStoryActivitySheet();},{passive:true});
document.getElementById("storyViewerDialog")?.addEventListener("close",()=>{
  stopStoryLikeLiveAnimation();
  stopStoryViewerTimer();
  stopGramoraStoryAudio(true);
  closeStoryActivitySheet();
});
document.getElementById("storyViewerPrevious")?.addEventListener("click",()=>navigateStoryViewer(-1));
document.getElementById("storyViewerNext")?.addEventListener("click",()=>navigateStoryViewer(1));
function openStoryViewer(docs,id){
  const activitySheet=document.getElementById("storyActivitySheet");
  if(activitySheet)activitySheet.hidden=true;
  storyViewerPaused=false;
  const storyDoc=docs.find(item=>item.id===id);if(!storyDoc)return;
  const data=storyDoc.data(),dialog=document.getElementById("storyViewerDialog");
  storyViewerSequence=dialog._highlightStories?.length?dialog._highlightStories:docs.filter(item=>item.data().uid===data.uid).sort((a,b)=>(a.data().createdAt?.toMillis?.()||0)-(b.data().createdAt?.toMillis?.()||0));
  storyViewerIndex=storyViewerSequence.findIndex(item=>item.id===id);if(storyViewerIndex<0)storyViewerIndex=0;
  dialog.dataset.storyId=id;
  const isOwnStory=data.uid===auth?.currentUser?.uid&&!dialog._highlightStories?.length;
  stopStoryLikeLiveAnimation();
  if(isOwnStory)watchStoryLikesForOwner(id,data.uid);
  const content=document.getElementById("storyViewerText");
  const deleteButton=document.getElementById("storyViewerDelete");
  const ownerActions=document.getElementById("storyOwnerActions");
  const ownerMenu=document.getElementById("storyOwnerMenu");
  if(ownerActions)ownerActions.hidden=!isOwnStory;
  if(ownerMenu)ownerMenu.hidden=true;
  ownerActions?.querySelectorAll("[data-story-owner-action]").forEach(button=>{
    button.onclick=async()=>{
      if(!isOwnStory)return;
      const action=button.dataset.storyOwnerAction;
      if(action==="activity"){openStoryActivitySheet(id,data.uid);return;}
      if(action==="highlight"){openStoryHighlightChooser(auth.currentUser,id);return;}
      if(action==="more"){if(ownerMenu)ownerMenu.hidden=!ownerMenu.hidden;return;}
      if(action==="share"){
        const url=location.href.split("#")[0]+"#story-"+encodeURIComponent(id);
        try{if(navigator.share)await navigator.share({title:"GRAMORA story",text:"Check out my story on GRAMORA",url});else{await navigator.clipboard.writeText(url);if(document.getElementById("storyReplyStatus"))document.getElementById("storyReplyStatus").textContent="Story link copied.";}}
        catch(error){if(error.name!=="AbortError"&&document.getElementById("storyReplyStatus"))document.getElementById("storyReplyStatus").textContent="Share nahi ho paya. Dobara try karein.";}
      }
    };
  });
  const ownerEditAction=ownerMenu?.querySelector('[data-story-menu-action="edit"]');if(ownerEditAction)ownerEditAction.onclick=()=>{ownerMenu.hidden=true;editStoryButton?.click();};
  const ownerDeleteAction=ownerMenu?.querySelector('[data-story-menu-action="delete"]');if(ownerDeleteAction)ownerDeleteAction.onclick=()=>{ownerMenu.hidden=true;deleteButton?.click();};
  content.textContent=data.text||"";
  content.style.background=data.background||POST_BACKGROUNDS[4];
  const viewerLyrics=document.getElementById("storyViewerLyrics");if(viewerLyrics){viewerLyrics.textContent=data.lyrics||"";viewerLyrics.hidden=!(data.lyrics||"").trim();}
  const viewerName=document.getElementById("storyViewerName");if(viewerName)viewerName.textContent=data.displayName||"GRAMORA member";
  const viewerTime=document.getElementById("storyViewerTime");if(viewerTime)viewerTime.textContent=formatPostDate(data.createdAt);
  const avatar=document.getElementById("storyViewerAvatar");if(avatar){const profile=storyProfileCache.get(data.uid)||{};avatar.replaceChildren();if(profile.photoURL){const image=document.createElement("img");image.src=profile.photoURL;image.alt="";avatar.append(image);}else avatar.textContent=(data.displayName||"G").trim().charAt(0).toUpperCase();if(!storyProfileCache.has(data.uid))getStoryProfile(data.uid).then(p=>{if(dialog.dataset.storyId===id&&p?.photoURL){const image=document.createElement("img");image.src=p.photoURL;image.alt="";avatar.replaceChildren(image);}});}
  renderStoryViewerProgress();
  markStorySeen(id);
  recordStoryView(id,data);
  const audio=document.getElementById("storyViewerAudio");
  if(audio){audio.pause();audio.removeAttribute("src");audio.load();audio.hidden=true;}
  const track=document.getElementById("storyViewerTrack");
  if(track){
    track.replaceChildren();
    track.hidden=!data.songTitle;
    if(data.songTitle){
      const icon=document.createElement("span");icon.className="gramora-story-track-icon";icon.textContent="♫";
      const details=document.createElement("span");details.className="gramora-story-track-details";
      const label=document.createElement("span");label.className="gramora-story-track-title";label.textContent=data.songTitle+(data.songArtist?" · "+data.songArtist:"");
      details.append(label);track.append(icon,details);
      if(data.previewUrl&&audio){
        audio.src=data.previewUrl;audio.hidden=false;audio.controls=false;
        const startAt=Math.max(0,Number(data.songStart||0));
        audio.ontimeupdate=()=>{
          if(audio.currentTime-startAt>=15)audio.pause();
        };
        audio.onloadedmetadata=()=>{try{audio.currentTime=startAt;}catch(error){}};
      }else if(data.songUrl){
        label.title="Tap to open song";label.style.textDecoration="underline";label.style.cursor="pointer";
        label.addEventListener("click",()=>window.open(data.songUrl,"_blank","noopener"));
      }
      getStoryProfile(data.uid).then(async profile=>{
        const username=await getUsernameForUid(data.uid,profile);
        const name=document.getElementById("storyViewerName");
        if(name&&dialog.dataset.storyId===id&&username)name.textContent="@"+username;
      });
    }
  }
  const editStoryButton=document.getElementById("storyViewerEdit");
  if(editStoryButton){
    editStoryButton.hidden=!!dialog._highlightStories?.length||data.uid!==auth?.currentUser?.uid;
    editStoryButton.onclick=()=>{
      if(data.uid!==auth?.currentUser?.uid)return;
      storyEditingId=id;setStoryEditingMode(true);document.getElementById("storyText").value=data.text||"";if(storyCharCount)storyCharCount.textContent=String((data.text||"").length);
      const bg=data.background||POST_BACKGROUNDS[4];document.getElementById("storyBackground").value=bg;document.getElementById("storyPreviewCanvas").style.background=bg;
      document.querySelectorAll("#storyBackgroundPicker [data-bg]").forEach(button=>button.classList.toggle("selected",button.dataset.bg===bg));
      document.getElementById("storySongTitle").value=data.songTitle||"";document.getElementById("storySongLyrics").value=data.lyrics||"";document.getElementById("storyLyricsEditor").hidden=!data.songTitle;document.getElementById("storyLyricsPreview").textContent=data.lyrics||"";document.getElementById("storyLyricsPreview").hidden=!(data.lyrics||"").trim();document.getElementById("storySongArtist").value=data.songArtist||"";document.getElementById("storySongUrl").value=data.songUrl||"";document.getElementById("storySongPreviewUrl").value=data.previewUrl||"";document.getElementById("storySongArtwork").value=data.songArtwork||"";document.getElementById("storySongStart").value=String(data.songStart||0);document.getElementById("storyMusicAttached").hidden=!data.songTitle;document.getElementById("storySongAttachedTitle").textContent=data.songTitle||"";document.getElementById("storySongAttachedArtist").textContent=data.songArtist||"";document.getElementById("storySongArtworkPreview").src=data.songArtwork||"";
      document.getElementById("storyCreateDialog").querySelector("h2").textContent="Edit your story";document.querySelector("#storyForm button[type=submit]").textContent="Save story";
      dialog.close();document.getElementById("storyCreateDialog").showModal();
    };
  }
  if(deleteButton){
    deleteButton.hidden=!!dialog._highlightStories?.length||data.uid!==auth?.currentUser?.uid;
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
  if(isOwnStory)renderStoryActivityPreview(id,data.uid);
  if(!dialog.open)dialog.showModal();
  if(audio&&!audio.hidden){
    const playAttempt=audio.play();
    if(playAttempt&&typeof playAttempt.catch==="function")playAttempt.catch(()=>{});
  }
  startStoryViewerTimer();
}
async function getStoryViewerPeople(storyId,ownerUid){
  const snap=await getDocs(query(collection(db,"storyViews"),where("storyUid","==",ownerUid)));
  return snap.docs.filter(item=>item.data().storyId===storyId).sort((a,b)=>(b.data().createdAt?.toMillis?.()||0)-(a.data().createdAt?.toMillis?.()||0));
}
async function renderStoryActivityPreview(storyId,ownerUid){
  const button=document.querySelector('#storyOwnerActions [data-story-owner-action="activity"]');
  if(!button)return;
  const label=button.querySelector("span"),icon=button.querySelector("svg");if(!label)return;
  try{
    const entries=await getStoryViewerPeople(storyId,ownerUid);
    if(document.getElementById("storyViewerDialog")?.dataset.storyId!==storyId)return;
    if(!entries.length){
      button.classList.remove("has-viewer-avatars");
      button.querySelector(".gramora-activity-avatar-stack")?.remove();
      if(icon)icon.hidden=false;
      label.hidden=false;label.textContent="Activity";button.title="Story activity";return;
    }
    const viewers=await Promise.all(entries.slice(0,3).map(async item=>{
      const data=item.data(),profileSnap=await getDoc(doc(db,"userProfiles",data.uid)),profile=profileSnap.exists()?profileSnap.data():{};
      return {uid:data.uid,photoURL:profile.photoURL||profile.photoUrl||profile.avatarUrl||"",name:profile.displayName||data.displayName||"Viewer"};
    }));
    if(document.getElementById("storyViewerDialog")?.dataset.storyId!==storyId)return;
    let stack=button.querySelector(".gramora-activity-avatar-stack");
    if(!stack){stack=document.createElement("span");stack.className="gramora-activity-avatar-stack";button.append(stack);}
    stack.replaceChildren();
    viewers.forEach((person,index)=>{
      const avatar=document.createElement("span");avatar.className="gramora-activity-avatar";avatar.style.setProperty("--avatar-order",String(index));avatar.title=person.name;
      if(person.photoURL){const img=document.createElement("img");img.src=person.photoURL;img.alt="";img.loading="lazy";avatar.append(img);}
      else avatar.textContent=(person.name||"G").trim().charAt(0).toUpperCase();
      stack.append(avatar);
    });
    button.classList.add("has-viewer-avatars");
    if(icon)icon.hidden=true;
    label.hidden=true;button.title=entries.length+" views";
  }catch(error){console.error("Story activity preview failed:",error);}
}
function closeStoryActivitySheet(){
  const sheet=document.getElementById("storyActivitySheet");
  if(sheet)sheet.hidden=true;
  storyViewerPaused=false;
}
let storyLikeLiveUnsubscribe=null;
let storyLikeLiveStoryId="";
function stopStoryLikeLiveAnimation(){
  if(storyLikeLiveUnsubscribe){storyLikeLiveUnsubscribe();storyLikeLiveUnsubscribe=null;}
  storyLikeLiveStoryId="";
}
function animateStoryLikeHearts(){
  const stage=document.getElementById("storyViewerStage");if(!stage)return;
  const layer=document.createElement("div");layer.className="gramora-story-like-float-layer";layer.setAttribute("aria-hidden","true");
  stage.append(layer);
  const symbols=["♥","❤","♥","💕"];
  for(let i=0;i<9;i++){
    const heart=document.createElement("span");heart.className="gramora-story-like-float";
    heart.textContent=symbols[i%symbols.length];
    heart.style.setProperty("--heart-x",(12+Math.random()*76)+"%");
    heart.style.setProperty("--heart-delay",(Math.random()*650)+"ms");
    heart.style.setProperty("--heart-size",(22+Math.random()*28)+"px");
    layer.append(heart);
  }
  window.setTimeout(()=>layer.remove(),3600);
}
function watchStoryLikesForOwner(storyId,ownerUid){
  stopStoryLikeLiveAnimation();
  if(ownerUid!==auth?.currentUser?.uid)return;
  storyLikeLiveStoryId=storyId;
  let firstSnapshot=true;
  storyLikeLiveUnsubscribe=onSnapshot(query(collection(db,"storyLikes"),where("storyUid","==",ownerUid)),snapshot=>{
    if(firstSnapshot){firstSnapshot=false;return;}
    if(storyLikeLiveStoryId!==storyId||document.getElementById("storyViewerDialog")?.dataset.storyId!==storyId)return;
    const newLikes=snapshot.docChanges().filter(change=>change.type==="added"&&change.doc.data().storyId===storyId&&change.doc.data().uid!==ownerUid);
    if(newLikes.length)animateStoryLikeHearts();
  },error=>console.warn("Story like animation listener failed:",error));
}
async function openStoryActivitySheet(storyId,ownerUid){
  const dialog=document.getElementById("storyViewerDialog"),sheet=document.getElementById("storyActivitySheet");
  if(!dialog||!sheet||dialog.dataset.storyId!==storyId||ownerUid!==auth?.currentUser?.uid)return;
  sheet.hidden=false;storyViewerPaused=true;
  const count=document.getElementById("storyActivityCount"),list=document.getElementById("storyActivityList");
  if(count)count.textContent="… views";
  if(list){list.replaceChildren();const loading=document.createElement("p");loading.textContent="Loading viewers…";list.append(loading);}
  try{
    const entries=await getStoryViewerPeople(storyId,ownerUid);
    if(dialog.dataset.storyId!==storyId||sheet.hidden)return;
    if(count)count.textContent=entries.length.toLocaleString()+" "+(entries.length===1?"view":"views");
    if(!list)return;
    list.replaceChildren();
    if(!entries.length){const empty=document.createElement("p");empty.className="gramora-story-no-viewers";empty.textContent="No viewers yet";list.append(empty);return;}
    for(const item of entries){
      const data=item.data();if(!data.uid)continue;
      const profileSnap=await getDoc(doc(db,"userProfiles",data.uid)),profile=profileSnap.exists()?profileSnap.data():{};
      const username=await getUsernameForUid(data.uid,profile)||"user";
      const row=document.createElement("button");row.type="button";row.className="gramora-story-viewer-row";
      const avatar=document.createElement("span");avatar.className="gramora-story-viewer-avatar";
      if(profile.photoURL){const img=document.createElement("img");img.src=profile.photoURL;img.alt="";avatar.append(img);}else avatar.textContent=(profile.displayName||data.displayName||username).trim().charAt(0).toUpperCase();
      const info=document.createElement("span");info.className="gramora-story-viewer-info";
      const name=document.createElement("strong");name.textContent=profile.displayName||data.displayName||"GRAMORA member";
      const id=document.createElement("small");id.textContent="@"+username;
      info.append(name,id);row.append(avatar,info);
      const likeSnap=await getDoc(doc(db,"storyLikes",storyId+"_"+data.uid));
      if(likeSnap.exists()){const heart=document.createElement("span");heart.className="gramora-story-viewer-like-heart";heart.textContent="♥";heart.setAttribute("aria-label","Liked your story");avatar.append(heart);}
      row.addEventListener("click",async()=>{closeStoryActivitySheet();dialog.close();await openPersonProfile(data.uid);});
      list.append(row);
    }
  }catch(error){
    console.error("Story viewers could not load:",error);
    if(count)count.textContent="Views";
    if(list){list.replaceChildren();const message=document.createElement("p");message.className="gramora-story-no-viewers";message.textContent="Viewers load nahi hue. Firestore Rules check karein.";list.append(message);}
  }
}
async function showStoryPeopleList(storyId,type){
  const viewer=auth?.currentUser;if(!viewer)return;
  const isLikes=type==="likes",title=isLikes?"Story likes":"Story viewers",collectionName=isLikes?"storyLikes":"storyViews";
  const dialog=document.createElement("dialog");dialog.className="follow-list-dialog post-likes-dialog";
  const head=document.createElement("div");head.className="follow-list-head";
  const heading=document.createElement("h3");heading.textContent=title;
  const close=document.createElement("button");close.type="button";close.className="follow-list-close";close.textContent="×";close.addEventListener("click",()=>dialog.close());
  head.append(heading,close);dialog.append(head);
  const body=document.createElement("div");body.className="follow-list-body";body.textContent="Loading…";dialog.append(body);
  document.body.append(dialog);dialog.addEventListener("close",()=>dialog.remove(),{once:true});dialog.showModal();
  try{
    const snap=await getDocs(query(collection(db,collectionName),where("storyUid","==",viewer.uid),limit(500)));
    const entries=snap.docs.filter(d=>d.data().storyId===storyId);
    const people=await Promise.all(entries.map(async d=>{
      const data=d.data();if(!data.uid)return null;
      const ps=await getDoc(doc(db,"userProfiles",data.uid)),profile=ps.exists()?ps.data():{};
      return {uid:data.uid,name:profile.displayName||data.displayName||"GRAMORA member",username:await getUsernameForUid(data.uid,profile),photoURL:profile.photoURL||""};
    }));
    body.replaceChildren();
    if(!people.filter(Boolean).length){body.textContent=isLikes?"No likes yet.":"No viewers yet.";return;}
    people.filter(Boolean).forEach(person=>{
      const row=document.createElement("div");row.className="follow-person-row";
      const open=document.createElement("button");open.type="button";open.className="follow-person-profile";
      const avatar=document.createElement("span");avatar.className="follow-person-avatar";
      if(person.photoURL){const img=document.createElement("img");img.src=person.photoURL;img.alt="";avatar.append(img);}else avatar.textContent=person.name.trim().charAt(0).toUpperCase();
      const info=document.createElement("span");info.className="follow-person-info";
      const name=document.createElement("strong");name.textContent=person.name;
      const username=document.createElement("small");username.textContent="@"+(person.username||"username-not-set");
      info.append(name,username);open.append(avatar,info);open.addEventListener("click",async()=>{
        dialog.close();
        document.getElementById("storyViewerDialog")?.close();
        await openPersonProfile(person.uid);
      });row.append(open);body.append(row);
    });
  }catch(error){console.error("Story people list failed:",error);body.textContent="List load nahi hui. Firestore Rules check karein.";}
}
async function loadStoryEngagement(storyId,storyData){
  const likeButton=document.getElementById("storyViewerLike");
  const replyList=document.getElementById("storyReplyList");
  const replyHeading=document.getElementById("storyRepliesHeading");
  const replyStatus=document.getElementById("storyReplyStatus");
  const currentUid=auth?.currentUser?.uid;
  if(!currentUid)return;
  const isOwner=storyData.uid===currentUid;
  const replyRow=document.querySelector(".gramora-viewer-reply-row");if(replyRow)replyRow.hidden=isOwner;
  if(replyList)replyList.hidden=!isOwner;
  if(replyHeading)replyHeading.hidden=!isOwner;
  try{
    const ownLikeId=storyId+"_"+currentUid;
    let liked=false;
    if(isOwner){
      const likesSnap=await getDocs(query(collection(db,"storyLikes"),where("storyUid","==",currentUid)));
      if(document.getElementById("storyViewerDialog")?.dataset.storyId!==storyId)return;
      const storyLikes=likesSnap.docs.filter(item=>item.data().storyId===storyId);
      liked=storyLikes.some(item=>item.id===ownLikeId);
    }else{
      const ownLikeSnap=await getDoc(doc(db,"storyLikes",ownLikeId));
      if(document.getElementById("storyViewerDialog")?.dataset.storyId!==storyId)return;
      liked=ownLikeSnap.exists();
    }
    if(likeButton){
      likeButton.classList.toggle("liked",liked);
      likeButton.setAttribute("aria-pressed",String(liked));
      likeButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.8c0 5.1-8.8 10.2-8.8 10.2S3.2 13.9 3.2 8.8A4.6 4.6 0 0 1 12 6.5a4.6 4.6 0 0 1 8.8 2.3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
      likeButton.onclick=async()=>{
        likeButton.disabled=true;
        try{
          const ref=doc(db,"storyLikes",ownLikeId);
          const snap=await getDoc(ref);
          if(snap.exists())await deleteDoc(ref);
          else {await setDoc(ref,{storyId,storyUid:storyData.uid,uid:currentUid,createdAt:serverTimestamp()});await createGramoraNotification(storyData.uid,"story_like","liked your story.",{storyId});}
          await loadStoryEngagement(storyId,storyData);
        }catch(error){console.error("Story like failed:",error);if(replyStatus)replyStatus.textContent="Like save nahi hua. Firestore Rules check karein.";}
        finally{likeButton.disabled=false;}
      };
    }
  }catch(error){console.error("Story likes load failed:",error);}
  if(isOwner){
    try{
      const repliesSnap=await getDocs(query(collection(db,"storyReplies"),where("storyOwnerUid","==",currentUid)));
      if(document.getElementById("storyViewerDialog")?.dataset.storyId!==storyId)return;
      const replies=repliesSnap.docs.map(item=>({id:item.id,...item.data()})).filter(reply=>reply.storyId===storyId).sort((x,y)=>(y.createdAt?.toMillis?.()||0)-(x.createdAt?.toMillis?.()||0));
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
    }catch(error){console.error("Story replies load failed:",error);if(replyList)replyList.textContent="Replies load nahi ho paye. Firestore Rules check karein.";}
  }else if(replyList){replyList.replaceChildren();}
}
const storyReplyForm=document.getElementById("storyReplyForm");
const storyReplyInput=document.getElementById("storyReplyInput");
const storyReplySend=storyReplyForm?.querySelector('button[type="submit"]');
if(storyReplySend)storyReplySend.hidden=true;
storyReplyInput?.addEventListener("input",()=>{
  if(storyReplySend)storyReplySend.hidden=!storyReplyInput.value.trim();
});
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
    await createGramoraNotification(story.data().uid,"story_reply","replied to your story: "+text.slice(0,90),{storyId});
    let chatSynced=false;
    try{
      const ownerUid=story.data().uid;
      const blockStatus=await getBlockStatus(user.uid,ownerUid);
      if(!blockStatus.blockedByMe&&!blockStatus.blockedMe){
        const conversationsSnap=await getDocs(query(collection(db,"conversations"),where("participantUids","array-contains",user.uid)));
        const existingConversation=conversationsSnap.docs.find(item=>(item.data().participantUids||[]).includes(ownerUid));
        let conversationRef;
        if(existingConversation)conversationRef=existingConversation.ref;
        else conversationRef=await addDoc(collection(db,"conversations"),{
          participantUids:[user.uid,ownerUid],createdBy:user.uid,createdAt:serverTimestamp(),
          updatedAt:serverTimestamp(),lastMessage:"",lastMessageAt:serverTimestamp(),lastMessageSenderUid:user.uid
        });
        const chatText="↪ Story reply: "+text;
        await addDoc(collection(db,"conversations",conversationRef.id,"messages"),{
          senderUid:user.uid,text:chatText,type:"text",status:"sent",createdAt:serverTimestamp()
        });
        await updateDoc(conversationRef,{
          lastMessage:chatText,lastMessageAt:serverTimestamp(),lastMessageSenderUid:user.uid,updatedAt:serverTimestamp()
        });
        chatSynced=true;
      }
    }catch(chatError){console.error("Story reply chat sync failed:",chatError);}
    input.value="";button.hidden=true;
    status.textContent=chatSynced?"Reply sent! It also appears in your chat.":"Reply sent! Notification delivered; chat could not be synced.";
    await loadStoryEngagement(storyId,story.data());
  }catch(error){console.error("Story reply failed:",error);status.textContent="Reply nahi bhej paye. Firestore Rules check karein.";}
  finally{button.disabled=false;}
});

const storyMusicSheet=document.getElementById("storyMusicSheet");
const storyMusicPreview=document.getElementById("storyMusicPreview");
const storyMusicSelection=document.getElementById("storyMusicSelection");
const storyMusicAttached=document.getElementById("storyMusicAttached");
const storySongSearchButton=document.getElementById("storySongSearchButton");
const storySongSearchInput=document.getElementById("storySongSearch");
const storySongResults=document.getElementById("storySongResults");
const storyPreviewInput=document.getElementById("storySongPreviewUrl");
const setStoryMusicPreview=async()=>{
  if(!storyMusicPreview||!storyPreviewInput?.value)return;
  storyMusicPreview.src=storyPreviewInput.value;
  storyMusicPreview.currentTime=Number(document.getElementById("storySongStart").value||0);
  try{await storyMusicPreview.play();}catch(error){console.warn("Preview playback needs a user tap:",error);}
};
const stopStoryMusicPreview=()=>{
  if(storyMusicPreview){
    storyMusicPreview.pause();
    storyMusicPreview.removeAttribute("src");
    storyMusicPreview.load();
  }
  clearGramoraMediaSession();
};
function clearGramoraMediaSession(){
  try{
    if("mediaSession" in navigator){
      navigator.mediaSession.playbackState="none";
      navigator.mediaSession.metadata=null;
    }
  }catch(error){}
}
function stopGramoraStoryAudio(releaseSource=false){
  if(storyMusicPreview){
    storyMusicPreview.pause();
    if(releaseSource){storyMusicPreview.removeAttribute("src");storyMusicPreview.load();}
  }
  const viewerAudio=document.getElementById("storyViewerAudio");
  if(viewerAudio){
    viewerAudio.pause();
    if(releaseSource){viewerAudio.removeAttribute("src");viewerAudio.load();}
  }
  clearGramoraMediaSession();
}
document.addEventListener("visibilitychange",()=>{
  const viewerAudio=document.getElementById("storyViewerAudio");
  if(document.hidden){
    stopGramoraStoryAudio();
    storyViewerPaused=true;
    stopStoryViewerTimer();
  }else{
    const viewer=document.getElementById("storyViewerDialog");
    if(viewer?.open){
      if(viewerAudio&&!viewerAudio.hidden&&viewerAudio.src){
        const playAttempt=viewerAudio.play();
        if(playAttempt?.catch)playAttempt.catch(()=>{});
      }
      storyViewerPaused=false;
      startStoryViewerTimer();
    }
  }
});
window.addEventListener("pagehide",()=>stopGramoraStoryAudio(true));
window.addEventListener("beforeunload",()=>stopGramoraStoryAudio(true));
window.addEventListener("freeze",()=>stopGramoraStoryAudio(true));
const storyEditorDone=document.getElementById("storyEditorDone");
const setStoryEditingMode=editing=>{
  if(!storyTextArea||!storyEditorDone)return;
  storyTextArea.readOnly=!editing;
  storyEditorDone.textContent=editing?"Done":"Edit text";
  storyEditorDone.setAttribute("aria-pressed",String(!editing));
  storyEditorDone.setAttribute("aria-label",editing?"Finish editing story text":"Edit story text");
  storyTextArea.classList.toggle("story-text-locked",!editing);
};
storyEditorDone?.addEventListener("click",()=>{
  const status=document.getElementById("storyCreateStatus");
  if(storyTextArea?.readOnly){
    setStoryEditingMode(true);
    if(status)status.textContent="Text editing mode — apni story update karein.";
    storyTextArea?.focus();
    return;
  }
  if(!storyTextArea?.value.trim()){
    if(status)status.textContent="Pehle story text likhein, phir Done dabayein.";
    storyTextArea?.focus();
    return;
  }
  if(storyMusicSheet)storyMusicSheet.hidden=true;
  stopStoryMusicPreview();
  storyTextArea.blur();
  setStoryEditingMode(false);
  if(status)status.textContent="Text ready ✓ Ab Share story dabakar publish karein.";
  document.getElementById("storyShareSubmit")?.scrollIntoView({behavior:"smooth",block:"nearest"});
});
document.getElementById("openStoryMusic")?.addEventListener("click",()=>{if(storyMusicSheet)storyMusicSheet.hidden=false;});
document.getElementById("closeStoryMusic")?.addEventListener("click",()=>{stopStoryMusicPreview();if(storyMusicSheet)storyMusicSheet.hidden=true;});
storySongSearchButton?.addEventListener("click",async()=>{
  const term=storySongSearchInput?.value.trim();
  if(!term){storySongResults.textContent="Song ya singer ka naam likhein.";storySongSearchInput?.focus();return;}
  storySongSearchButton.disabled=true;storySongResults.textContent="Songs search ho rahe hain…";
  try{
    const response=await fetch("https://itunes.apple.com/search?term="+encodeURIComponent(term)+"&entity=song&limit=15&country=IN");
    if(!response.ok)throw new Error("Song search service unavailable");
    const result=await response.json();storySongResults.replaceChildren();
    if(!result.results?.length){storySongResults.textContent="Koi song nahi mila. Dusra naam try karein.";return;}
    result.results.forEach(track=>{
      const option=document.createElement("button");option.type="button";option.className="story-song-result";
      const cover=document.createElement("img");cover.src=track.artworkUrl100||"";cover.alt="";cover.loading="lazy";
      const details=document.createElement("span");details.className="gramora-track-details";
      const title=document.createElement("b");title.textContent=track.trackName||"Unknown song";
      const artist=document.createElement("small");artist.textContent=(track.artistName||"Unknown artist")+" · "+(track.collectionName||"");
      details.append(title,artist);option.append(cover,details);
      option.addEventListener("click",()=>{
        if(!track.previewUrl){storySongResults.textContent="Is track ka playable preview available nahi hai. Dusra song chunein.";return;}
        document.getElementById("storySongTitle").value=track.trackName||"";
        document.getElementById("storySongArtist").value=track.artistName||"";
        document.getElementById("storySongUrl").value=track.trackViewUrl||"";
        document.getElementById("storySongArtwork").value=track.artworkUrl100||"";
        storyPreviewInput.value=track.previewUrl;
        document.getElementById("storySongStart").value="0";
        document.getElementById("storyMusicSelectedArtwork").src=track.artworkUrl100||"";
        document.getElementById("storyMusicSelectedTitle").textContent=track.trackName||"Unknown song";
        document.getElementById("storyMusicSelectedArtist").textContent=track.artistName||"";
        document.getElementById("storyMusicStartSlider").value="0";
        document.getElementById("storyMusicStartValue").textContent="0:00";
        storyMusicSelection.hidden=false;
        storySongResults.querySelectorAll(".story-song-result").forEach(row=>row.classList.toggle("selected",row===option));
        storyMusicPreview.src=track.previewUrl;
        storyMusicPreview.currentTime=0;
      });
      storySongResults.append(option);
    });
  }catch(error){console.error("Song search failed:",error);storySongResults.textContent="Song search abhi nahi ho payi. Internet connection check karein.";}
  finally{storySongSearchButton.disabled=false;}
});
document.getElementById("storyMusicStartSlider")?.addEventListener("input",event=>{
  const start=Number(event.target.value||0);document.getElementById("storySongStart").value=String(start);
  document.getElementById("storyMusicStartValue").textContent="0:"+String(start).padStart(2,"0");
  if(storyMusicPreview&&!storyMusicPreview.paused)storyMusicPreview.currentTime=start;
});
document.getElementById("storyMusicPreviewInSheet")?.addEventListener("click",async event=>{
  if(!storyPreviewInput?.value){storySongResults.textContent="Pehle song select karein.";return;}
  if(storyMusicPreview.paused){await setStoryMusicPreview();event.currentTarget.textContent="Ⅱ Pause preview";}
  else{stopStoryMusicPreview();event.currentTarget.textContent="▶ Preview";}
});
document.getElementById("storyMusicPreviewToggle")?.addEventListener("click",async event=>{
  if(!storyPreviewInput?.value)return;
  if(storyMusicPreview.paused){await setStoryMusicPreview();event.currentTarget.textContent="Ⅱ Pause";}
  else{stopStoryMusicPreview();event.currentTarget.textContent="▶ Preview";}
});
document.getElementById("addStoryMusic")?.addEventListener("click",()=>{
  if(!storyPreviewInput?.value){storySongResults.textContent="Pehle preview wala song select karein.";return;}
  const title=document.getElementById("storySongTitle").value,artist=document.getElementById("storySongArtist").value,art=document.getElementById("storySongArtwork").value;
  document.getElementById("storySongAttachedTitle").textContent=title;
  document.getElementById("storySongAttachedArtist").textContent=artist;
  document.getElementById("storySongArtworkPreview").src=art;
  storyMusicAttached.hidden=false;stopStoryMusicPreview();storyMusicSheet.hidden=true;const lyrics=document.getElementById("storySongLyrics").value.trim();document.getElementById("storyLyricsPreview").textContent=lyrics;document.getElementById("storyLyricsPreview").hidden=!lyrics;
});
document.getElementById("storyMusicRemove")?.addEventListener("click",()=>{
  stopStoryMusicPreview();["storySongTitle","storySongArtist","storySongUrl","storySongPreviewUrl","storySongArtwork"].forEach(id=>document.getElementById(id).value="");
  document.getElementById("storySongStart").value="0";storyMusicAttached.hidden=true;storyMusicSelection.hidden=true;
});
const storyTextArea=document.getElementById("storyText");
const storyCharCount=document.getElementById("storyCharCount");
storyTextArea?.addEventListener("input",()=>{if(storyCharCount)storyCharCount.textContent=String(storyTextArea.value.length);});
document.getElementById("storySongLyrics")?.addEventListener("input",event=>{const preview=document.getElementById("storyLyricsPreview");preview.textContent=event.target.value;preview.hidden=!event.target.value.trim();});
document.querySelectorAll(".gramora-story-style-strip [data-story-font]").forEach(button=>button.addEventListener("click",()=>{
  const fonts={classic:"650 32px Arial,sans-serif",modern:"700 32px system-ui,sans-serif",elegant:"italic 500 32px Georgia,serif",strong:"800 32px Impact,sans-serif"};
  storyTextArea.style.font=fonts[button.dataset.storyFont]||fonts.classic;
  document.querySelectorAll(".gramora-story-style-strip [data-story-font]").forEach(item=>item.classList.toggle("active",item===button));
}));
document.getElementById("storyTextStyleToggle")?.addEventListener("click",()=>{
  const el=document.getElementById("storyText"),styles=["650 32px Arial,sans-serif","italic 500 32px Georgia,serif","800 32px Impact,sans-serif"];const n=Number(el.dataset.styleIndex||0)%styles.length;el.style.font=styles[n];el.dataset.styleIndex=String(n+1);
});
const storyTextColors=["#ffffff","#ffe682","#ff9ecb","#9de7ff","#b9ffb2","#171923"];
let storyTextColorIndex=0;
const storyColorButton=document.getElementById("storyTextColorToggle");
storyColorButton?.addEventListener("click",()=>{
  const el=document.getElementById("storyText");
  storyTextColorIndex=(storyTextColorIndex+1)%storyTextColors.length;
  const color=storyTextColors[storyTextColorIndex];
  el.style.setProperty("color",color,"important");
  storyColorButton.style.setProperty("--story-color-preview",color);
  storyColorButton.setAttribute("aria-label","Text colour: "+color+". Tap to change");
  storyColorButton.classList.add("is-active");
});
document.getElementById("storyTextAlignToggle")?.addEventListener("click",()=>{
  const el=document.getElementById("storyText");el.style.textAlign=el.style.textAlign==="left"?"center":el.style.textAlign==="center"?"right":"left";
});
storyMusicPreview?.addEventListener("ended",()=>{
  document.getElementById("storyMusicPreviewInSheet").textContent="▶ Preview";
  document.getElementById("storyMusicPreviewToggle").textContent="▶ Preview";
});

document.querySelectorAll(".gramora-music-tabs [data-music-tab]").forEach(tab=>tab.addEventListener("click",()=>{
  document.querySelectorAll(".gramora-music-tabs [data-music-tab]").forEach(item=>item.classList.toggle("active",item===tab));
  const mode=tab.dataset.musicTab;
  if(mode==="for-you"){storySongSearchInput.value="popular Hindi songs";storySongResults.textContent="Search dabayein to recommendations dekhein.";}
  else if(mode==="trending"){storySongSearchInput.value="top hits India";storySongSearchButton.click();}
  else if(mode==="saved"){storySongResults.textContent="Saved songs abhi empty hain. Song choose karne ke baad use Saved list mein rakhne ka option baad mein add karenge.";}
  else{storySongResults.textContent="Original audio upload/recording abhi available nahi hai.";}
}));

const storyForm=document.getElementById("storyForm");
storyForm?.addEventListener("submit",async event=>{
  event.preventDefault();
  const status=document.getElementById("storyCreateStatus");
  const button=storyForm.querySelector('button[type="submit"]');
  const text=document.getElementById("storyText").value.trim();
  const background=document.getElementById("storyBackground").value||POST_BACKGROUNDS[4];
  const songTitle=document.getElementById("storySongTitle").value.trim();
  const lyrics=document.getElementById("storySongLyrics").value.trim();
  const songArtist=document.getElementById("storySongArtist").value.trim();
  const songUrl=document.getElementById("storySongUrl").value.trim();
  const previewUrl=storyPreviewInput?.value.trim()||"";
  const songArtwork=document.getElementById("storySongArtwork").value.trim();
  const songStart=Number(document.getElementById("storySongStart").value||0);
  if(!auth?.currentUser){status.textContent="Story share karne ke liye login karein.";return;}
  if(!text&&!songTitle){status.textContent="Story text likhein ya song add karein.";return;}
  if(songUrl&&!/^https:\/\/(open\.spotify\.com|music\.apple\.com|music\.youtube\.com|www\.youtube\.com|youtu\.be)\//i.test(songUrl)){
    status.textContent="Valid Apple Music, Spotify ya YouTube song link add karein.";return;
  }
  button.disabled=true;button.textContent=storyEditingId?"Saving…":"Sharing…";status.textContent=storyEditingId?"Story update ho rahi hai…":"Story publish ho rahi hai…";
  try{
    const user=auth.currentUser;
    const profileSnap=await getDoc(doc(db,"userProfiles",user.uid));
    const profile=profileSnap.exists()?profileSnap.data():{};
    if(storyEditingId){
      await updateDoc(doc(db,"stories",storyEditingId),{text,lyrics,background,songTitle,songArtist,songUrl,previewUrl,songArtwork,songStart});storyEditingId=null;status.textContent="Story update ho gayi!";
    }else{
      await addDoc(collection(db,"stories"),{uid:user.uid,displayName:profile.displayName||user.displayName||"GRAMORA member",text,lyrics,songTitle,songArtist,songUrl,previewUrl,songArtwork,songStart,background,createdAt:serverTimestamp(),expiresAt:Timestamp.fromMillis(Date.now()+24*60*60*1000)});
      status.textContent="Story share ho gayi!";
    }
    storyForm.reset();setStoryEditingMode(true);if(storyEditorDone)storyEditorDone.textContent="Done";if(storyCharCount)storyCharCount.textContent="0";if(storyTextArea){storyTextArea.style.font="";storyTextArea.style.color="#fff";storyTextArea.style.textAlign="center";}document.querySelectorAll(".gramora-story-style-strip [data-story-font]").forEach((item,index)=>item.classList.toggle("active",index===0));stopStoryMusicPreview();if(storyMusicAttached)storyMusicAttached.hidden=true;if(storyMusicSelection)storyMusicSelection.hidden=true;document.getElementById("storyLyricsEditor").hidden=true;document.getElementById("storyLyricsPreview").hidden=true;storySongResults?.replaceChildren();
    document.getElementById("storyCreateDialog").close();document.getElementById("storyCreateDialog").querySelector("h2").textContent="Create a text story";
  }catch(error){
    console.error("Story publish failed:",error);
    status.textContent=error.code==="permission-denied"?"Firestore Rules publish karein.":"Story publish nahi hui: "+(error.message||"Try again.");
  }finally{button.disabled=false;button.textContent=storyEditingId?"Save story":"Share story";}
});
document.getElementById("closeStoryCreate")?.addEventListener("click",()=>document.getElementById("storyCreateDialog").close());
document.getElementById("storyCreateDialog")?.addEventListener("close",()=>{
  stopStoryMusicPreview();
  if(storyEditingId){storyEditingId=null;storyForm?.reset();}
  setStoryEditingMode(true);
  const heading=document.getElementById("storyCreateDialog").querySelector("h2");
  if(heading)heading.textContent="Create a text story";
  const submit=storyForm?.querySelector('button[type="submit"]');if(submit)submit.textContent="Share story";
});
document.getElementById("createDialog")?.addEventListener("close",()=>{
  if(editingPostId){editingPostId=null;document.getElementById("caption").value="";}
  const heading=document.querySelector("#createDialog h2");if(heading)heading.textContent="Create a post";
  const submit=postForm?.querySelector(".publish");if(submit)submit.textContent="Share with the community ↗";
});
document.getElementById("closeStoryViewer")?.addEventListener("click",()=>{const audio=document.getElementById("storyViewerAudio");audio?.pause();document.getElementById("storyViewerDialog").close();});
document.getElementById("storyViewerDialog")?.addEventListener("close",()=>{const audio=document.getElementById("storyViewerAudio");audio?.pause();});
async function getVisibleContentUids(user){
  const [profilesSnap,followsSnap]=await Promise.all([
    getDocs(query(collection(db,"userProfiles"),limit(100))),
    getDocs(query(collection(db,"follows"),where("followerUid","==",user.uid),limit(200)))
  ]);
  const followed=new Set(followsSnap.docs.map(item=>item.data().followingUid));
  return [...new Set([user.uid,...profilesSnap.docs.filter(item=>item.id===user.uid||item.data().isPrivate!==true||followed.has(item.id)).map(item=>item.id)])];
}
async function migrateOwnedRepostsToFeed(user){
  if(!user?.uid)return;
  try{
    const owned=await getDocs(query(collection(db,"reposts"),where("originalUid","==",user.uid),limit(500)));
    for(const item of owned.docs){
      const target=doc(db,"repostFeed",item.id);
      if(!(await getDoc(target)).exists())await setDoc(target,item.data());
    }
  }catch(error){console.warn("Legacy repost feed migration is waiting for the latest Firestore Rules:",error.code||error);}
}
function startPostsFeed(user){
  migrateOwnedRepostsToFeed(user);
  if(activeFeedUnsubscribe)activeFeedUnsubscribe();
  let posts=[],reposts=[],ready=0,total=0,offs=[],cancelled=false,completed=false;
  const feedLoadTimer=setTimeout(()=>{
    if(!cancelled&&!completed&&activeView==="home"){
      showFeedRetryMessage("Your feed is taking longer than expected. Check your connection and try again.",user);
    }
  },12000);
  const renderCombined=()=>{
    if(cancelled||ready<total)return;
    completed=true;clearTimeout(feedLoadTimer);
    if(activeView!=="home")return;
    const repostDocs=reposts.map(item=>({id:"repost_"+item.id,data:()=>({...item.data(),_isRepost:true,_repostId:item.id})}));
    renderPosts([...posts,...repostDocs].sort((a,b)=>(b.data().createdAt?.toMillis?.()||0)-(a.data().createdAt?.toMillis?.()||0)).slice(0,60));
  };
  activeFeedUnsubscribe=()=>{cancelled=true;clearTimeout(feedLoadTimer);offs.forEach(off=>off());};
  getVisibleContentUids(user).then(uids=>{
    if(cancelled)return;
    const groups=[];for(let i=0;i<uids.length;i+=30)groups.push(uids.slice(i,i+30));
    total=uids.length+groups.length*groups.length;
    if(!total){completed=true;clearTimeout(feedLoadTimer);renderPosts([]);return;}
    uids.forEach(uid=>{
      offs.push(onSnapshot(query(collection(db,"posts"),where("uid","==",uid),limit(100)),snap=>{posts=posts.filter(item=>item.data().uid!==uid).concat(snap.docs);ready++;renderCombined();},error=>{console.warn("A profile's posts are not visible:",error.code||error);ready++;renderCombined();}));
    });
    groups.forEach(reposterBatch=>groups.forEach(originalBatch=>{
      offs.push(onSnapshot(query(collection(db,"repostFeed"),where("uid","in",reposterBatch),where("originalUid","in",originalBatch),limit(100)),snap=>{
        reposts=reposts.filter(item=>!(reposterBatch.includes(item.data().uid)&&originalBatch.includes(item.data().originalUid))).concat(snap.docs);
        ready++;renderCombined();
      },error=>{console.warn("Reposts feed unavailable:",error.code||error);ready++;renderCombined();}));
    }));
  }).catch(error=>{console.error(error);completed=true;clearTimeout(feedLoadTimer);if(activeView==="home")showFeedRetryMessage("Could not prepare your feed ("+(error.code||"network error")+"). Check your connection and Firestore Rules, then retry.",user);});
}
function showFeedRetryMessage(message,user){
  const feed=document.getElementById("feed");
  if(!feed)return;
  feed.replaceChildren();
  const copy=document.createElement("p");copy.className="muted";copy.textContent=message;
  copy.style.cssText="padding:24px 18px 10px;text-align:center;line-height:1.6";
  const retry=document.createElement("button");retry.type="button";retry.textContent="Retry feed";
  retry.style.cssText="display:block;margin:8px auto 24px;padding:11px 22px;border:0;border-radius:999px;background:linear-gradient(110deg,#d85c9a,#8b68dc);color:#fff;font-weight:800;cursor:pointer";
  retry.addEventListener("click",()=>startPostsFeed(user));
  feed.append(copy,retry);
}
function showFeedMessage(text){
  const feed=document.getElementById("feed");
  feed.replaceChildren();
  const p=document.createElement("p");p.className="muted";p.textContent=text;feed.append(p);
}
async function refreshPostSaveButton(postId,button,countNode){
  const user=auth?.currentUser;if(!user||!button)return;
  try{
    const snap=await getDoc(doc(db,"savedPosts",postId+"_"+user.uid));
    if(!button.isConnected)return;
    button.classList.toggle("saved",snap.exists());
    button.setAttribute("aria-pressed",String(snap.exists()));
    button.setAttribute("aria-label",snap.exists()?"Remove saved post":"Save post");
    if(countNode?.isConnected){
      const all=await getDocs(query(collection(db,"postSaves"),where("postId","==",postId),where("postUid","==",button.dataset.postUid||""),limit(500)));
      if(countNode.isConnected)countNode.textContent=displayPostActionCount(all.size);
    }
  }catch(error){console.warn("Saved post state unavailable:",error);}
}
async function togglePostSave(postId,button,countNode){
  const user=auth?.currentUser;if(!user)return;
  const wasSaved=button.classList.contains("saved"),oldCount=Number(countNode?.textContent)||0;
  button.classList.toggle("saved",!wasSaved);button.setAttribute("aria-pressed",String(!wasSaved));
  button.setAttribute("aria-label",wasSaved?"Save post":"Remove saved post");
  if(countNode)countNode.textContent=displayPostActionCount(Math.max(0,oldCount+(wasSaved?-1:1)));
  button.disabled=true;
  try{
    const ref=doc(db,"savedPosts",postId+"_"+user.uid),publicRef=doc(db,"postSaves",postId+"_"+user.uid);
    if(wasSaved){await deleteDoc(ref);await deleteDoc(publicRef);}
    else{
      await setDoc(ref,{postId,uid:user.uid,createdAt:serverTimestamp()});
      await setDoc(publicRef,{postId,postUid:button.dataset.postUid||"",uid:user.uid,createdAt:serverTimestamp()});
    }
    if(activeView==="saved"&&wasSaved)await loadSavedPosts();
  }catch(error){
    button.classList.toggle("saved",wasSaved);button.setAttribute("aria-pressed",String(wasSaved));
    button.setAttribute("aria-label",wasSaved?"Remove saved post":"Save post");
    if(countNode)countNode.textContent=displayPostActionCount(oldCount);
    console.error("Save post failed:",error);
    alert(error.code==="permission-denied"?"Post saves count enable karne ke liye latest Firestore Rules publish karein.":"Post save nahi hui. Dobara try karein.");
  }finally{button.disabled=false;}
}
async function loadSavedPosts(){
  const user=auth?.currentUser;if(!user)return;
  const feed=document.getElementById("feed");
  showFeedMessage("Loading your saved posts…");
  try{
    const savedSnap=await getDocs(query(collection(db,"savedPosts"),where("uid","==",user.uid),limit(200)));
    const savedItems=await Promise.all(savedSnap.docs.map(async savedDoc=>{
      const postId=savedDoc.data().postId;
      if(!postId)return null;
      const postSnap=await getDoc(doc(db,"posts",postId));
      return postSnap.exists()?{id:postSnap.id,data:()=>postSnap.data(),_savedAt:savedDoc.data().createdAt}:null;
    }));
    if(activeView!=="saved")return;
    const posts=savedItems.filter(Boolean).sort((x,y)=>(y._savedAt?.toMillis?.()||0)-(x._savedAt?.toMillis?.()||0));
    if(!posts.length){
      feed.replaceChildren();
      const empty=document.createElement("div");empty.className="empty-welcome";
      const heading=document.createElement("h2");heading.textContent="Your saved posts will live here.";
      const note=document.createElement("p");note.textContent="Feed mein kisi post par Save dabayein. Woh yahan mil jayegi.";
      empty.append(heading,note);feed.append(empty);return;
    }
    renderPosts(posts);
  }catch(error){
    console.error("Saved posts load failed:",error);
    showFeedMessage(error.code==="permission-denied"?"Saved Posts ke liye latest Firestore Rules publish karein.":"Saved posts load nahi ho payi. Dobara try karein.");
  }
}
async function openPersonProfile(uid){
  const viewer=auth?.currentUser;if(!viewer||!uid)return;
  if(uid===viewer.uid)await loadProfilePage(viewer);else await loadPublicProfile(viewer,uid);
}
async function showPostLikesList(postId,postUid){
  const viewer=auth?.currentUser;if(!viewer)return;
  const dialog=document.createElement("dialog");dialog.className="follow-list-dialog post-likes-dialog";
  const head=document.createElement("div");head.className="follow-list-head";
  const title=document.createElement("h3");title.textContent="Liked by";
  const close=document.createElement("button");close.type="button";close.className="follow-list-close";close.textContent="×";close.setAttribute("aria-label","Close");close.addEventListener("click",()=>dialog.close());head.append(title,close);dialog.append(head);
  const body=document.createElement("div");body.className="follow-list-body";body.textContent="Loading…";dialog.append(body);
  document.body.append(dialog);dialog.addEventListener("close",()=>dialog.remove(),{once:true});dialog.showModal();
  try{
    const likes=await getDocs(query(collection(db,"postLikes"),where("postId","==",postId),where("postUid","==",postUid),limit(500)));
    body.replaceChildren();
    if(likes.empty){const empty=document.createElement("p");empty.className="follow-list-empty";empty.textContent="No likes yet.";body.append(empty);return;}
    const people=await Promise.all(likes.docs.map(async likeDoc=>{
      const like=likeDoc.data();if(!like.uid)return null;
      const profileSnap=await getDoc(doc(db,"userProfiles",like.uid));
      const profile=profileSnap.exists()?profileSnap.data():{};
      return {uid:like.uid,displayName:profile.displayName||like.displayName||"GRAMORA member",username:await getUsernameForUid(like.uid,profile),photoURL:profile.photoURL||""};
    }));
    people.filter(Boolean).forEach(person=>{
      const row=document.createElement("div");row.className="follow-person-row";
      const open=document.createElement("button");open.type="button";open.className="follow-person-profile";
      const avatar=document.createElement("span");avatar.className="follow-person-avatar";
      if(person.photoURL){const img=document.createElement("img");img.src=person.photoURL;img.alt="";avatar.append(img);}else avatar.textContent=person.displayName.trim().charAt(0).toUpperCase();
      const info=document.createElement("span");info.className="follow-person-info";
      const name=document.createElement("strong");name.textContent=person.displayName;
      const username=document.createElement("small");username.textContent="@"+(person.username||"username-not-set");info.append(name,username);open.append(avatar,info);
      open.addEventListener("click",()=>{dialog.close();openPersonProfile(person.uid);});row.append(open);body.append(row);
    });
    if(!body.children.length)body.textContent="Like karne wale profiles nahi mil paye.";
  }catch(error){console.error("Post likes list failed:",error);body.textContent="Likes list load nahi hui. Firestore Rules publish karein.";}
}
function bindPostActionLongPress(button,openList){
  if(!button||button.dataset.longPressListBound==="1")return ()=>false;
  button.dataset.longPressListBound="1";
  let timer=null,suppressClick=false;
  const cancel=()=>{if(timer){clearTimeout(timer);timer=null;}};
  button.addEventListener("pointerdown",()=>{
    cancel();
    timer=setTimeout(()=>{
      timer=null;suppressClick=true;
      if(navigator.vibrate)navigator.vibrate(18);
      openList();
      setTimeout(()=>{suppressClick=false;},900);
    },550);
  });
  ["pointerup","pointercancel","pointerleave"].forEach(type=>button.addEventListener(type,cancel));
  button.addEventListener("contextmenu",event=>event.preventDefault());
  return ()=>suppressClick;
}
async function showPostRepostsList(postId,postUid){
  const viewer=auth?.currentUser;if(!viewer||viewer.uid!==postUid)return;
  const dialog=document.createElement("dialog");dialog.className="follow-list-dialog post-likes-dialog";
  const head=document.createElement("div");head.className="follow-list-head";
  const title=document.createElement("h3");title.textContent="Reposted by";
  const close=document.createElement("button");close.type="button";close.className="follow-list-close";close.textContent="×";close.setAttribute("aria-label","Close");close.addEventListener("click",()=>dialog.close());
  head.append(title,close);dialog.append(head);
  const body=document.createElement("div");body.className="follow-list-body";body.textContent="Loading…";dialog.append(body);
  document.body.append(dialog);dialog.addEventListener("close",()=>dialog.remove(),{once:true});dialog.showModal();
  try{
    const reposts=await getDocs(query(collection(db,"reposts"),where("originalPostId","==",postId),where("originalUid","==",viewer.uid),limit(500)));
    body.replaceChildren();
    if(reposts.empty){const empty=document.createElement("p");empty.className="follow-list-empty";empty.textContent="No reposts yet.";body.append(empty);return;}
    const people=await Promise.all(reposts.docs.map(async repostDoc=>{
      const repost=repostDoc.data();if(!repost.uid)return null;
      const profileSnap=await getDoc(doc(db,"userProfiles",repost.uid));
      const profile=profileSnap.exists()?profileSnap.data():{};
      return {uid:repost.uid,displayName:profile.displayName||repost.displayName||"GRAMORA member",username:await getUsernameForUid(repost.uid,profile),photoURL:profile.photoURL||repost.photoURL||""};
    }));
    people.filter(Boolean).forEach(person=>{
      const row=document.createElement("div");row.className="follow-person-row";
      const open=document.createElement("button");open.type="button";open.className="follow-person-profile";
      const avatar=document.createElement("span");avatar.className="follow-person-avatar";
      if(person.photoURL){const img=document.createElement("img");img.src=person.photoURL;img.alt="";avatar.append(img);}else avatar.textContent=person.displayName.trim().charAt(0).toUpperCase();
      const info=document.createElement("span");info.className="follow-person-info";
      const name=document.createElement("strong");name.textContent=person.displayName;
      const username=document.createElement("small");username.textContent="@"+(person.username||"username-not-set");
      info.append(name,username);open.append(avatar,info);
      open.addEventListener("click",()=>{dialog.close();openPersonProfile(person.uid);});
      row.append(open);body.append(row);
    });
    if(!body.children.length)body.textContent="Repost karne wale profiles nahi mil paye.";
  }catch(error){console.error("Private post repost list failed:",error);body.textContent="Repost list load nahi hui. Latest Firestore Rules Firebase mein publish karein.";}
}
async function getPostEngagement(postId,postUid){
  const user=auth?.currentUser;if(!user)return {liked:false,count:0};
  const [own,all]=await Promise.all([
    getDoc(doc(db,"postLikes",postId+"_"+user.uid)),
    getDocs(query(collection(db,"postLikes"),where("postId","==",postId),where("postUid","==",postUid),limit(500)))
  ]);
  return {liked:own.exists(),count:all.size};
}
function displayPostActionCount(count){
  const value=Math.max(0,Number(count)||0);
  return value>0?String(value):"";
}
function ensurePostLikeCountNode(button,fallback=0){
  if(!button)return null;
  // Feed likes render their live count from data-like-count via CSS, avoiding
  // nested text nodes being touched by the global SVG icon observer.
  if(button.matches(".post-actions .like"))return null;
  let node=button.querySelector(".post-action-count");
  if(!node){
    node=document.createElement("span");
    node.className="post-action-count";
    node.textContent=displayPostActionCount(button.dataset.likeCount??fallback??0);
    button.append(node);
  }
  return node;
}
function setPostLikeCount(button,count){
  if(!button)return;
  const value=displayPostActionCount(count);
  button.dataset.likeCount=value;
  if(button.matches(".post-actions .like"))return;
  const node=ensurePostLikeCountNode(button,value);
  if(node)node.textContent=value;
}
async function refreshPostLikeButton(postId,postUid,button,countNode){
  const version=Number(button.dataset.likeVersion)||0;
  try{
    const state=await getPostEngagement(postId,postUid);
    if(!button.isConnected||(Number(button.dataset.likeVersion)||0)!==version)return;
    button.classList.toggle("liked",state.liked);button.setAttribute("aria-pressed",String(state.liked));
    button.setAttribute("aria-label",state.liked?"Unlike post":"Like post");
    setPostLikeCount(button,state.count);
  }catch(error){
    console.warn("Post likes unavailable:",error);
    if(button.isConnected&&(Number(button.dataset.likeVersion)||0)===version){
      const current=button.dataset.likeCount??countNode?.textContent??"0";
      setPostLikeCount(button,current);
    }
  }
}
async function togglePostLike(postId,postUid,button,countNode){
  const user=auth?.currentUser;if(!user||button.disabled)return;
  const wasLiked=button.classList.contains("liked");
  const version=(Number(button.dataset.likeVersion)||0)+1;
  const matching=Array.from(document.querySelectorAll(".post-actions .like")).filter(other=>other.dataset.postId===postId&&other.dataset.postUid===postUid);
  if(!matching.includes(button))matching.push(button);
  const visibleCounts=matching.map(other=>Number(other.dataset.likeCount??other.querySelector(".post-action-count")?.textContent)||0);
  const oldCount=Math.max(0,...visibleCounts,Number(button.dataset.likeCount??countNode?.textContent)||0);
  const nextCount=Math.max(0,oldCount+(wasLiked?-1:1));
  const applyVisibleState=(liked,count)=>{
    matching.forEach(other=>{
      other.classList.toggle("liked",liked);
      other.setAttribute("aria-pressed",String(liked));
      other.setAttribute("aria-label",liked?"Unlike post":"Like post");
      setPostLikeCount(other,count);
    });
    const detail=document.getElementById("postDetailLike");
    if(detail&&currentViewedPost?.id===postId&&currentViewedPost?.uid===postUid){
      detail.classList.toggle("liked",liked);detail.setAttribute("aria-pressed",String(liked));
      detail.setAttribute("aria-label",liked?"Unlike post":"Like post");
      setPostLikeCount(detail,count);
      const total=document.getElementById("postDetailLikeCount");if(total)total.textContent=String(count);
    }
  };
  const operationVersion=version;
  matching.forEach(other=>{other.dataset.likeVersion=String(operationVersion);});
  applyVisibleState(!wasLiked,nextCount);
  button.disabled=true;
  try{
    const ref=doc(db,"postLikes",postId+"_"+user.uid),snap=await getDoc(ref);
    if(snap.exists())await deleteDoc(ref);
    else{
      const profileSnap=await getDoc(doc(db,"userProfiles",user.uid)),profile=profileSnap.exists()?profileSnap.data():{};
      await setDoc(ref,{postId,postUid,uid:user.uid,displayName:profile.displayName||user.displayName||"GRAMORA member",createdAt:serverTimestamp()});
      createGramoraNotification(postUid,"post_like","liked your post.",{postId}).catch(error=>console.warn("Like notification failed:",error));
    }
    const latest=await getDocs(query(collection(db,"postLikes"),where("postId","==",postId),where("postUid","==",postUid),limit(500)));
    const finalLiked=!snap.exists();
    const finalCount=latest.size;
    matching.forEach(other=>{
      if(other.isConnected&&(Number(other.dataset.likeVersion)||0)===operationVersion){
        other.classList.toggle("liked",finalLiked);other.setAttribute("aria-pressed",String(finalLiked));
        other.setAttribute("aria-label",finalLiked?"Unlike post":"Like post");
        setPostLikeCount(other,finalCount);
      }
    });
    const detail=document.getElementById("postDetailLike");
    if(detail&&currentViewedPost?.id===postId&&currentViewedPost?.uid===postUid){
      detail.classList.toggle("liked",finalLiked);detail.setAttribute("aria-pressed",String(finalLiked));
      detail.setAttribute("aria-label",finalLiked?"Unlike post":"Like post");
      setPostLikeCount(detail,finalCount);
      const total=document.getElementById("postDetailLikeCount");if(total)total.textContent=String(finalCount);
    }
  }catch(error){
    matching.forEach(other=>{
      if((Number(other.dataset.likeVersion)||0)===operationVersion){
        other.classList.toggle("liked",wasLiked);other.setAttribute("aria-pressed",String(wasLiked));
        other.setAttribute("aria-label",wasLiked?"Unlike post":"Like post");
        setPostLikeCount(other,oldCount);
      }
    });
    console.error("Post like failed:",error);alert(error.code==="permission-denied"?"Publish the latest Firestore Rules to enable post likes.":"Could not update like. Please try again.");
  }finally{button.disabled=false;}
}
async function refreshVisiblePostCommentCount(post){
  try{
    const snap=await getDocs(query(collection(db,"postComments"),where("postId","==",post.id),where("postUid","==",post.uid),limit(500)));
    document.querySelectorAll(".post-comment-open").forEach(button=>{
      if(button.dataset.postId===post.id&&button.dataset.postUid===post.uid){
        const count=button.querySelector(".post-action-count");if(count)count.textContent=displayPostActionCount(snap.size);
      }
    });
  }catch(error){console.warn("Post comment count unavailable:",error);}
}
async function loadPostEngagement(post,root){
  const likeCount=root.querySelector("#postDetailLikeCount"),likeButton=root.querySelector("#postDetailLike"),list=root.querySelector("#postDetailComments"),status=root.querySelector("#postCommentStatus");
  if(!list)return;
  list.replaceChildren();status.textContent="Loading likes and comments…";
  try{
    const [likesSnap,commentsSnap,ownLike]=await Promise.all([
      getDocs(query(collection(db,"postLikes"),where("postId","==",post.id),where("postUid","==",post.uid),limit(500))),
      getDocs(query(collection(db,"postComments"),where("postId","==",post.id),where("postUid","==",post.uid),limit(100))),
      getDoc(doc(db,"postLikes",post.id+"_"+auth.currentUser.uid))
    ]);
    if(likeCount){likeCount.textContent=String(likesSnap.size);likeCount.onclick=()=>showPostLikesList(post.id,post.uid);}
    likeButton.classList.toggle("liked",ownLike.exists());likeButton.setAttribute("aria-pressed",String(ownLike.exists()));
    likeButton.setAttribute("aria-label",ownLike.exists()?"Unlike post":"Like post");
    const detailCount=likeButton.querySelector(".post-action-count");if(detailCount)detailCount.textContent=String(likesSnap.size);
    list.replaceChildren();
    if(commentsSnap.empty){const empty=document.createElement("p");empty.className="muted tiny";empty.textContent="Abhi koi comment nahi hai. Pehla comment karein!";list.append(empty);}
    commentsSnap.docs.sort((x,y)=>(x.data().createdAt?.toMillis?.()||0)-(y.data().createdAt?.toMillis?.()||0)).forEach(item=>{
      const d=item.data(),row=document.createElement("div");row.className="post-comment-item";
      const author=document.createElement("button");author.type="button";author.className="post-comment-author";author.textContent=d.displayName||"GRAMORA member";author.addEventListener("click",()=>openPersonProfile(d.uid));
      const message=document.createElement("span");message.textContent=d.text||"";row.append(author,message);
      if(d.uid){getDoc(doc(db,"userProfiles",d.uid)).then(profileSnap=>{if(!author.isConnected)return;const profile=profileSnap.exists()?profileSnap.data():{};const username=profile.username||"";author.title=username?"@"+username:"Open profile";}).catch(()=>{});}
      if(d.uid===auth.currentUser.uid){const del=document.createElement("button");del.type="button";del.textContent="×";del.setAttribute("aria-label","Delete comment");del.addEventListener("click",async()=>{del.disabled=true;try{await deleteDoc(doc(db,"postComments",item.id));await refreshVisiblePostCommentCount(post);await loadPostEngagement(post,root);}catch(error){alert("Comment delete nahi hua. Firestore Rules check karein.");del.disabled=false;}});row.append(del);}
      list.append(row);
    });
    status.textContent="";
  }catch(error){console.error("Post engagement load failed:",error);status.textContent=error.code==="permission-denied"?"Latest Firestore Rules publish karein.":"Likes/comments load nahi ho paye.";
  }
}
function renderPosts(docs){
  const feed=document.getElementById("feed");feed.replaceChildren();
  if(!docs.length){const empty=document.createElement("div");empty.className="empty-welcome";const heading=document.createElement("h2");heading.textContent="Your feed is ready.";const note=document.createElement("p");note.textContent="Be the first to share a moment with the GRAMORA community.";empty.append(heading,note);feed.append(empty);return;}
  docs.forEach(postDoc=>{
    const data=postDoc.data(),isRepost=!!data._isRepost;
    const authorUid=isRepost?data.originalUid:data.uid,authorName=isRepost?data.originalDisplayName:data.displayName;
    const authorUsername=isRepost?data.originalUsername:data.username,authorPhoto=isRepost?data.originalPhotoURL:data.photoURL;
    const article=document.createElement("article");article.className="post";
    let repostAvatar=null,repostText=null;
    if(isRepost){
      const by=document.createElement("button");by.type="button";by.className="post-reposted-by";
      repostAvatar=document.createElement("span");repostAvatar.className="post-repost-avatar";
      if(data.photoURL){const img=document.createElement("img");img.src=data.photoURL;img.alt="";repostAvatar.append(img);}
      else repostAvatar.textContent=(data.displayName||"G").trim().charAt(0).toUpperCase();
      repostText=document.createElement("span");repostText.textContent=(data.displayName||"GRAMORA member")+" reposted";
      by.append(repostAvatar,repostText);by.addEventListener("click",()=>openPersonProfile(data.uid));article.append(by);
    }
    const head=document.createElement("button");head.className="post-head post-author-link";head.type="button";
    const avatar=document.createElement("div");avatar.className="avatar";avatar.textContent=(authorName||"G").trim().charAt(0).toUpperCase();
     bindAvatarLongPress(avatar,authorUid,{displayName:authorName||"GRAMORA member",photoURL:authorPhoto||""});
    if(authorPhoto){const img=document.createElement("img");img.src=authorPhoto;img.alt="";avatar.textContent="";avatar.append(img);}
    else if(authorUid){getDoc(doc(db,"userProfiles",authorUid)).then(profileSnap=>{if(profileSnap.exists()){const photo=profileSnap.data().photoURL;if(photo&&avatar.isConnected){const img=document.createElement("img");img.src=photo;img.alt="";avatar.textContent="";avatar.append(img);}}}).catch(error=>console.warn("Post author photo unavailable:",error));}
    const identity=document.createElement("span");identity.className="post-author-identity";
    const name=document.createElement("b");name.textContent=authorName||"GRAMORA member";
    const meta=document.createElement("small");meta.textContent=(authorUsername?"@"+authorUsername+" · ":"")+formatPostDate(isRepost?data.originalCreatedAt:data.createdAt);
    identity.append(name,meta);head.append(avatar,identity);head.addEventListener("click",()=>{const viewer=auth?.currentUser;if(viewer&&authorUid)loadPublicProfile(viewer,authorUid);});
    const content=document.createElement("p");content.className="post-text post-text-card";content.textContent=isRepost?(data.originalText||""):(data.text||"");content.style.background=isRepost?(data.originalBackground||POST_BACKGROUNDS[4]):(data.background||POST_BACKGROUNDS[4]);
    const actions=document.createElement("div");actions.className="post-actions";
    const like=document.createElement("button");like.className="like";like.type="button";like.dataset.likeCount="";
    const comment=document.createElement("button");comment.className="post-comment-open";comment.type="button";comment.innerHTML='<span class="post-action-count"></span>';
    const repost=document.createElement("button");repost.className="repost";repost.type="button";repost.innerHTML='<span class="post-action-count"></span>';
    const save=document.createElement("button");save.className="save";save.type="button";save.innerHTML='<span class="post-action-count"></span>';
    const originalId=isRepost?data.originalPostId:postDoc.id;
    const originalData=isRepost?{uid:data.originalUid,displayName:data.originalDisplayName,username:data.originalUsername,photoURL:data.originalPhotoURL,text:data.originalText,background:data.originalBackground,createdAt:data.originalCreatedAt}:data;
    const postForDetail={id:originalId,...originalData};
    const likeCount=like.querySelector(".post-action-count"),commentCount=comment.querySelector(".post-action-count"),repostCount=repost.querySelector(".post-action-count"),saveCount=save.querySelector(".post-action-count");
    like.setAttribute("aria-label","Like post");comment.setAttribute("aria-label","View comments");repost.setAttribute("aria-label","Repost");save.setAttribute("aria-label","Save post");
    article.dataset.postId=originalId;article.dataset.postUid=authorUid;
    like.dataset.postId=originalId;like.dataset.postUid=authorUid;
    comment.dataset.postId=originalId;comment.dataset.postUid=authorUid;
    save.dataset.postUid=authorUid;
    save.addEventListener("click",()=>togglePostSave(originalId,save,saveCount));
    const likeHoldState=bindPostActionLongPress(like,()=>showPostLikesList(originalId,authorUid));
    like.addEventListener("click",()=>{if(likeHoldState())return;togglePostLike(originalId,authorUid,like,likeCount);});
    comment.addEventListener("click",()=>openPostDetail(postForDetail,false));
    repost.dataset.postId=originalId;repost.dataset.postUid=authorUid;
    const repostHoldState=auth?.currentUser?.uid===authorUid?bindPostActionLongPress(repost,()=>showPostRepostsList(originalId,authorUid)):()=>false;
    repost.addEventListener("click",()=>{if(repostHoldState())return;createPostRepost(originalId,originalData,repost);});
    actions.append(like,comment,repost,save);
    article.append(head,content,actions);
    if(!isRepost&&auth?.currentUser?.uid===data.uid){
      const edit=document.createElement("button");edit.className="edit-post";edit.type="button";edit.textContent="Edit";edit.addEventListener("click",()=>openPostEditor({id:postDoc.id,...data}));actions.append(edit);
      const del=document.createElement("button");del.className="delete-post";del.type="button";del.textContent="Delete";del.addEventListener("click",()=>deleteOwnPost(postDoc.id,del,()=>getDocsForFeed()));actions.append(del);
    }
    feed.append(article);
    // Load like state only after the card is attached; otherwise a fast cached read can leave “Loading likes…” stuck.
    refreshPostLikeButton(originalId,authorUid,like,likeCount);
    refreshPostSaveButton(originalId,save,saveCount);
    refreshPostActionCounts(originalId,authorUid,{comment:commentCount,repost:repostCount,save:saveCount});
    refreshPostRepostButton(originalId,authorUid,repost,repostCount);
    // Resolve the latest profile details instead of relying on old names saved in post documents.
    const profileUids=[authorUid,isRepost?data.uid:null].filter(Boolean);
    Promise.all(profileUids.map(uid=>getDoc(doc(db,"userProfiles",uid)).then(snap=>({uid,data:snap.exists()?snap.data():null}))))
      .then(results=>{
        if(!article.isConnected)return;
        const profiles=new Map(results.map(item=>[item.uid,item.data]));
        const latestAuthor=profiles.get(authorUid);
        if(latestAuthor){
          const latestName=latestAuthor.displayName||authorName||"GRAMORA member";
          const latestUsername=latestAuthor.username||authorUsername||"";
          name.textContent=latestName;
          meta.textContent=(latestUsername?"@"+latestUsername+" · ":"")+formatPostDate(isRepost?data.originalCreatedAt:data.createdAt);
          avatar.textContent=latestName.trim().charAt(0).toUpperCase()||"G";
          if(latestAuthor.photoURL){
            const img=document.createElement("img");img.src=latestAuthor.photoURL;img.alt="";avatar.replaceChildren(img);
          }
        }
        if(isRepost){
          const latestReposter=profiles.get(data.uid);
          const repostLabel=article.querySelector(".post-reposted-by");
          if(latestReposter&&repostText)repostText.textContent=(latestReposter.displayName||data.displayName||"GRAMORA member")+" reposted";
          if(latestReposter&&repostAvatar){
            repostAvatar.replaceChildren();
            if(latestReposter.photoURL){const img=document.createElement("img");img.src=latestReposter.photoURL;img.alt="";repostAvatar.append(img);}
            else repostAvatar.textContent=(latestReposter.displayName||data.displayName||"G").trim().charAt(0).toUpperCase();
          }
        }
      }).catch(error=>console.warn("Latest feed profile lookup failed:",error));
  });
}
async function getVisibleRepostCount(postId,postUid,user){
  const visibleUids=await getVisibleContentUids(user);
  const batches=[];for(let i=0;i<visibleUids.length;i+=30)batches.push(visibleUids.slice(i,i+30));
  const snapshots=await Promise.all(batches.map(batch=>getDocs(query(
    collection(db,"repostFeed"),
    where("uid","in",batch),
    where("originalPostId","==",postId),
    where("originalUid","==",postUid),
    limit(500)
  ))));
  return snapshots.reduce((total,snapshot)=>total+snapshot.size,0);
}
async function refreshPostActionCounts(postId,postUid,nodes){
  const jobs=[
    ["comment",query(collection(db,"postComments"),where("postId","==",postId),where("postUid","==",postUid),limit(500))],
    ["save",query(collection(db,"postSaves"),where("postId","==",postId),where("postUid","==",postUid),limit(500))]
  ];
  const results=await Promise.allSettled(jobs.map(([,q])=>getDocs(q)));
  results.forEach((result,index)=>{
    const node=nodes[jobs[index][0]];
    if(!node?.isConnected)return;
    node.textContent=result.status==="fulfilled"?displayPostActionCount(result.value.size):"";
  });
  const repostNode=nodes.repost,user=auth?.currentUser;
  if(repostNode?.isConnected&&user){
    try{repostNode.textContent=displayPostActionCount(await getVisibleRepostCount(postId,postUid,user));}
    catch(error){console.warn("Repost count unavailable:",error);}
  }
}
async function refreshPostRepostButton(postId,postUid,button,countNode){
  const user=auth?.currentUser;if(!user||!button)return;
  try{
    const [own,count]=await Promise.all([
      getDoc(doc(db,"reposts",postId+"_"+user.uid)),
      getVisibleRepostCount(postId,postUid,user)
    ]);
    if(!button.isConnected)return;
    button.classList.toggle("reposted",own.exists());
    button.setAttribute("aria-pressed",String(own.exists()));
    button.setAttribute("aria-label",own.exists()?"Unrepost":"Repost");
    if(countNode?.isConnected)countNode.textContent=displayPostActionCount(count);
  }catch(error){console.warn("Repost state/count unavailable:",error);}
}
function updateVisibleRepostButtons(postId,active,count){
  document.querySelectorAll(".post-actions .repost").forEach(button=>{
    if(button.dataset.postId!==postId)return;
    button.classList.toggle("reposted",active);
    button.setAttribute("aria-pressed",String(active));
    button.setAttribute("aria-label",active?"Unrepost":"Repost");
    const node=button.querySelector(".post-action-count");
    if(node)node.textContent=displayPostActionCount(count);
  });
}
async function createPostRepost(postId,original,button){
  const user=auth?.currentUser;if(!user||!button)return;
  const repostId=postId+"_"+user.uid,ref=doc(db,"reposts",repostId),feedRef=doc(db,"repostFeed",repostId);
  const countNode=button.querySelector(".post-action-count");
  const wasReposted=button.classList.contains("reposted");
  const oldCount=Number(countNode?.textContent)||0;
  button.disabled=true;
  button.classList.toggle("reposted",!wasReposted);
  button.setAttribute("aria-pressed",String(!wasReposted));
  button.setAttribute("aria-label",wasReposted?"Repost":"Unrepost");
  if(countNode)countNode.textContent=displayPostActionCount(Math.max(0,oldCount+(wasReposted?-1:1)));
  updateVisibleRepostButtons(postId,!wasReposted,Math.max(0,oldCount+(wasReposted?-1:1)));
  let repostStep="existing repost check";
  try{
    const existing=await getDoc(ref);
    if(existing.exists()){
      if(wasReposted){
        repostStep="repost remove";
        await deleteDoc(ref);
        repostStep="feed repost remove";
        if((await getDoc(feedRef)).exists())await deleteDoc(feedRef);
      }else{
        const saved=existing.data();
        repostStep="feed repost restore";
        if(!(await getDoc(feedRef)).exists())await setDoc(feedRef,saved);
      }
    }else{
      repostStep="profile check";
      const profileSnap=await getDoc(doc(db,"userProfiles",user.uid)),profile=profileSnap.exists()?profileSnap.data():{};
      const repostData={
        uid:user.uid,
        displayName:profile.displayName||user.displayName||"GRAMORA member",
        username:profile.username||"",
        photoURL:profile.photoURL||user.photoURL||"",
        originalPostId:postId,
        originalUid:original.uid,
        originalDisplayName:original.displayName||"GRAMORA member",
        originalUsername:original.username||"",
        originalPhotoURL:original.photoURL||"",
        originalText:original.text||"",
        originalBackground:original.background||POST_BACKGROUNDS[4],
        originalCreatedAt:original.createdAt||null,
        createdAt:serverTimestamp()
      };
      repostStep="repost save";
      await setDoc(ref,repostData);
      repostStep="feed repost save";
      await setDoc(feedRef,repostData);
    }
    repostStep="repost count refresh";
    const latestCount=await getVisibleRepostCount(postId,original.uid,user);
    repostStep="repost status refresh";
    const ownNow=(await getDoc(ref)).exists();
    updateVisibleRepostButtons(postId,ownNow,latestCount);
  }catch(error){
    console.error("Repost toggle failed at "+repostStep+":",error);
    updateVisibleRepostButtons(postId,wasReposted,oldCount);
    alert("Repost mein dikkat ("+repostStep+"): "+(error.code||"error")+". Is message ka screenshot bhejo.");
  }finally{button.disabled=false;}
}
async function deleteOwnPost(postId,button,afterDelete){
  if(!auth?.currentUser)return;
  if(!confirm("Delete this post permanently?"))return;
  button.disabled=true;button.textContent="Deleting…";
  try{await deleteDoc(doc(db,"posts",postId));if(typeof afterDelete==="function")await afterDelete();}
  catch(error){console.error("Delete post failed:",error);alert(error.code==="permission-denied"?"Firestore Rules denied deleting this post. Publish the latest rules.":"Could not delete this post. Please try again.");button.disabled=false;button.textContent="Delete";}
}
function formatPostDate(timestamp){
  if(!timestamp)return "Just now";
  const date=typeof timestamp.toDate==="function"?timestamp.toDate():new Date(typeof timestamp==="number"?(timestamp<1e12?timestamp*1000:timestamp):timestamp);
  if(Number.isNaN(date.getTime()))return "Just now";
  const minutes=Math.max(0,Math.floor((Date.now()-date.getTime())/60000));
  if(minutes<1)return "Just now";
  if(minutes<60)return minutes+" min";
  const hours=Math.floor(minutes/60);
  if(hours<24)return hours+" hr";
  const days=Math.floor(hours/24);
  return days+" day"+(days===1?"":"s");
}
document.addEventListener("gramora:view",event=>{
  activeView=event.detail;
  if(activeView==="profile" && auth?.currentUser) loadProfilePage(auth.currentUser);
  if(activeView==="explore" && auth?.currentUser) loadExplorePage(auth.currentUser);
  if(activeView==="saved" && auth?.currentUser) loadSavedPosts();
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
  feed.innerHTML='<section class="explore-page"><h2>Search</h2><div class="people-search-wrap"><span aria-hidden="true">⌕</span><input id="peopleSearch" type="search" placeholder="Search name or @username" autocomplete="off"></div><div id="exploreRecent" class="explore-recent"></div><p id="exploreStatus" class="muted tiny" hidden></p><div id="peopleResults" class="people-results"></div></section>';
  const input=feed.querySelector("#peopleSearch"),status=feed.querySelector("#exploreStatus"),results=feed.querySelector("#peopleResults"),recent=feed.querySelector("#exploreRecent");
  const historyKey="gramora_explore_history_"+user.uid;
  function readHistory(){try{return JSON.parse(localStorage.getItem(historyKey)||"[]").filter(item=>item&&item.uid&&item.uid!==user.uid);}catch(error){return [];}}
  function saveHistory(items){localStorage.setItem(historyKey,JSON.stringify(items.slice(0,12)));}
  function openPerson(person){
    const history=readHistory().filter(item=>item.uid!==person.uid);
    history.unshift({uid:person.uid,displayName:person.displayName||"GRAMORA member",username:person.username||"",photoURL:person.photoURL||""});
    saveHistory(history);
    person.uid===user.uid?loadProfilePage(user):loadPublicProfile(user,person.uid);
  }
  function avatarFor(person){
    const avatar=document.createElement("div");avatar.className="avatar";
    if(person.photoURL){const img=document.createElement("img");img.src=person.photoURL;img.alt="";avatar.append(img);}
    else avatar.textContent=(person.displayName||"G").trim().charAt(0).toUpperCase();
    return avatar;
  }
  function renderHistory(){
    const history=readHistory();recent.replaceChildren();
    if(input.value.trim()||!history.length)return;
    const head=document.createElement("div");head.className="explore-recent-head";
    const title=document.createElement("b");title.textContent="Recent";
    const clear=document.createElement("button");clear.type="button";clear.textContent="Clear all";clear.addEventListener("click",()=>{saveHistory([]);renderHistory();});
    head.append(title,clear);recent.append(head);
    history.forEach(person=>{
      const row=document.createElement("div");row.className="explore-history-row";
      const open=document.createElement("button");open.type="button";open.className="explore-history-person";
      const info=document.createElement("span");info.className="person-info";
      const name=document.createElement("b");name.textContent=person.displayName||"GRAMORA member";
      const handle=document.createElement("small");handle.textContent=person.username?"@"+person.username:"";
      info.append(name,handle);open.append(avatarFor(person),info);open.addEventListener("click",()=>openPerson(person));
      const remove=document.createElement("button");remove.type="button";remove.className="explore-history-remove";remove.textContent="×";remove.setAttribute("aria-label","Remove "+(person.displayName||"search history"));
      remove.addEventListener("click",()=>{saveHistory(readHistory().filter(item=>item.uid!==person.uid));renderHistory();});
      row.append(open,remove);recent.append(row);
    });
  }
  let people=[];
  function render(term=""){
    const q=term.trim().toLowerCase().replace(/^@/,"");results.replaceChildren();
    if(!q){status.hidden=true;renderHistory();return;}
    recent.replaceChildren();status.hidden=false;
    const matches=people.filter(p=>(p.displayName||"").toLowerCase().includes(q)||(p.username||"").toLowerCase().includes(q));
    if(!matches.length){const empty=document.createElement("p");empty.className="muted";empty.textContent="No matching people found.";results.append(empty);status.textContent="";return;}
    matches.slice(0,30).forEach(person=>{
      const card=document.createElement("button");card.type="button";card.className="person-result";card.addEventListener("click",()=>openPerson(person));
      const info=document.createElement("div");info.className="person-info";
      const name=document.createElement("b");name.textContent=person.displayName||"GRAMORA member";
      const handle=document.createElement("small");handle.textContent=person.username?"@"+person.username:"Username not set";
      info.append(name,handle);card.append(avatarFor(person),info);results.append(card);
    });
    status.textContent=matches.length+" matching people";
  }
  input.addEventListener("input",()=>render(input.value));renderHistory();
  try{
    const [profilesSnap,usernamesSnap,ownProfileSnap]=await Promise.all([
      getDocs(query(collection(db,"userProfiles"),limit(100))),getDocs(query(collection(db,"usernames"),limit(500))),getDoc(doc(db,"userProfiles",user.uid))
    ]);
    const usernameByUid=new Map();usernamesSnap.docs.forEach(d=>{const data=d.data();if(data.uid)usernameByUid.set(data.uid,d.id);});
    const profileMap=new Map();
    profilesSnap.docs.forEach(d=>{const data=d.data(),uid=data.uid||d.id;profileMap.set(uid,{...data,id:d.id,uid,username:data.username||usernameByUid.get(uid)||""});});
    if(ownProfileSnap.exists()){const data=ownProfileSnap.data();profileMap.set(user.uid,{...data,id:user.uid,uid:user.uid,username:data.username||usernameByUid.get(user.uid)||""});}
    people=[...profileMap.values()];render(input.value);
  }catch(error){
    console.error("Explore profiles error:",error);status.hidden=false;
    status.textContent=error.code==="permission-denied"?"Explore needs signed-in profile read permission in Firestore Rules.":"Could not load people. Check your connection.";
  }
}

let activeChatUnsubscribe=null;
let activeChatTypingUnsubscribe=null;
let activeChatPresenceUnsubscribe=null;
let activeChatPresenceTimer=null;
let activeChatPresenceData=null;
let activeChatConversationId=null;
function renderGramoraChatPresence(status,data){
  if(!status)return;
  const stamp=data?.lastSeen?.toDate?.();
  const fresh=!!(data?.online&&stamp&&(Date.now()-stamp.getTime()<=90000));
  if(fresh){status.textContent="● Active now";status.style.color="#31c875";}
  else{status.textContent=stamp?"Last seen "+stamp.toLocaleString():"Offline";status.style.color="";}
}
let chatTypingTimer=null;
let chatTypingStopTimer=null;
let chatReplyTarget=null;
let chatEditTarget=null;
function closeGramoraChat(){
  if(activeChatUnsubscribe){activeChatUnsubscribe();activeChatUnsubscribe=null;}
  if(activeChatTypingUnsubscribe){activeChatTypingUnsubscribe();activeChatTypingUnsubscribe=null;}
  if(activeChatPresenceUnsubscribe){activeChatPresenceUnsubscribe();activeChatPresenceUnsubscribe=null;}
  if(activeChatPresenceTimer){clearInterval(activeChatPresenceTimer);activeChatPresenceTimer=null;}
  activeChatPresenceData=null;
  if(chatTypingStopTimer)clearTimeout(chatTypingStopTimer);
  if(activeChatConversationId&&auth?.currentUser)deleteDoc(doc(db,"conversations",activeChatConversationId,"typing",auth.currentUser.uid)).catch(()=>{});
  activeChatConversationId=null;chatReplyTarget=null;chatEditTarget=null;
  const dlg=document.getElementById("gramoraChatDialog");
  if(dlg?.open)dlg.close();
}
async function openGramoraChat(viewer,targetUid,targetProfile){
  try{
    if(!viewer||!targetUid||viewer.uid===targetUid)return;
    const blockStatus=await getBlockStatus(viewer.uid,targetUid);
    if(blockStatus.blockedByMe||blockStatus.blockedMe){alert("Is account ke saath chat nahi kar sakte. Block setting check karein.");return;}
    const targetName=targetProfile?.displayName||targetProfile?.username||"GRAMORA member";
    const targetUsername=targetProfile?.username||"member";
    const targetPhoto=targetProfile?.photoURL||"";
    let dlg=document.getElementById("gramoraChatDialog");
    if(!dlg){
      dlg=document.createElement("dialog");dlg.id="gramoraChatDialog";dlg.className="gramora-chat-dialog";document.body.append(dlg);
      dlg.addEventListener("close",()=>{
        if(activeChatUnsubscribe){activeChatUnsubscribe();activeChatUnsubscribe=null;}
        if(activeChatTypingUnsubscribe){activeChatTypingUnsubscribe();activeChatTypingUnsubscribe=null;}
        if(activeChatPresenceUnsubscribe){activeChatPresenceUnsubscribe();activeChatPresenceUnsubscribe=null;}
        if(chatTypingStopTimer)clearTimeout(chatTypingStopTimer);
        if(activeChatConversationId&&auth?.currentUser)deleteDoc(doc(db,"conversations",activeChatConversationId,"typing",auth.currentUser.uid)).catch(()=>{});
        activeChatConversationId=null;document.body.classList.remove("gramora-chat-open");
      });
    }
    dlg.innerHTML='<div class="gramora-chat-shell"><header class="gramora-chat-header"><button type="button" class="gramora-chat-back" aria-label="Back">‹</button><div class="gramora-chat-person"><div class="gramora-chat-avatar">'+(targetPhoto?'<img src="'+escapeHtml(targetPhoto)+'" alt="">':escapeHtml(targetName.charAt(0).toUpperCase()))+'</div><div><strong>'+escapeHtml(targetName)+'</strong><small class="gramora-chat-status">Checking status…</small></div></div><span class="gramora-chat-spacer"></span><button type="button" class="gramora-chat-more" aria-label="Chat options" title="Chat options">⋯</button></header><div class="gramora-chat-options" hidden><button type="button" class="gramora-chat-option-theme"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 1.4-3.4 1.7 1.7 0 0 1 1.2-2.9H18a3 3 0 0 0 3-3c0-4.8-4-8.7-9-8.7Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7.5" cy="10" r="1" fill="currentColor"/><circle cx="10" cy="6.8" r="1" fill="currentColor"/><circle cx="15" cy="7.5" r="1" fill="currentColor"/></svg><span>Chat theme</span></button><button type="button" class="gramora-chat-option-find"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4.2 4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span>Find in chats</span></button><button type="button" class="gramora-chat-option-clear"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 4v5m4-5v5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Clear all chat</span></button></div><div class="gramora-chat-theme-panel" hidden><div class="gramora-chat-theme-title"><strong>Choose chat theme</strong><button type="button" class="gramora-chat-theme-close" aria-label="Close">×</button></div><div class="gramora-chat-theme-grid"><button type="button" data-chat-theme="default"><i></i>Classic</button><button type="button" data-chat-theme="love"><i></i>Love</button><button type="button" data-chat-theme="ocean"><i></i>Ocean</button><button type="button" data-chat-theme="sunset"><i></i>Sunset</button><button type="button" data-chat-theme="midnight"><i></i>Midnight</button><button type="button" data-chat-theme="mint"><i></i>Mint</button></div></div><div class="gramora-chat-messages"><p class="gramora-chat-loading">Loading conversation…</p></div><div class="gramora-chat-typing" hidden aria-label="Typing"><span></span><span></span><span></span></div><div class="gramora-chat-replybar" hidden></div><div class="gramora-sticker-panel" hidden><div class="gramora-gif-head"><strong>GIFs</strong><button type="button" class="gramora-gif-close" aria-label="Close GIFs">×</button></div><input class="gramora-gif-search" type="search" maxlength="50" placeholder="Search GIFs…" aria-label="Search GIFs"><div class="gramora-gif-results"><span>Loading trending GIFs…</span></div><small class="gramora-giphy-credit">Powered by GIPHY</small><div class="gramora-sticker-grid"><button type="button" class="gramora-sticker" data-sticker="❤️">❤️</button><button type="button" class="gramora-sticker" data-sticker="😂">😂</button><button type="button" class="gramora-sticker" data-sticker="🥰">🥰</button><button type="button" class="gramora-sticker" data-sticker="🔥">🔥</button><button type="button" class="gramora-sticker" data-sticker="👏">👏</button><button type="button" class="gramora-sticker" data-sticker="😍">😍</button><button type="button" class="gramora-sticker" data-sticker="😭">😭</button><button type="button" class="gramora-sticker" data-sticker="✨">✨</button><button type="button" class="gramora-sticker" data-sticker="👍">👍</button><button type="button" class="gramora-sticker" data-sticker="🎉">🎉</button><button type="button" class="gramora-sticker" data-sticker="🤝">🤝</button><button type="button" class="gramora-sticker" data-sticker="💯">💯</button><button type="button" class="gramora-sticker" data-sticker="😎">😎</button><button type="button" class="gramora-sticker" data-sticker="🥳">🥳</button><button type="button" class="gramora-sticker" data-sticker="💖">💖</button><button type="button" class="gramora-sticker" data-sticker="🙌">🙌</button></div></div><form class="gramora-chat-compose"><button type="button" class="gramora-chat-sticker-toggle" aria-label="Stickers and GIF"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 14s1.4 2 4 2 4-2 4-2M9 9h.01M15 9h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button><input type="text" maxlength="2000" autocomplete="off" placeholder="Message…" aria-label="Write a message"><button type="submit" aria-label="Send message"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-5 16-3.5-6.5L4 12Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m11.5 13.5 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></form></div>';
    if(!document.getElementById("gramora-chat-style")){
      const style=document.createElement("style");style.id="gramora-chat-style";
      style.textContent='.gramora-chat-dialog{position:fixed;inset:0;margin:0;width:100%;height:100%;min-width:100%;min-height:100%;max-width:none;max-height:none;padding:0;border:0;border-radius:0;background:var(--bg,#101116);color:var(--text,#fff);overflow:hidden;overscroll-behavior:contain}.gramora-chat-dialog::backdrop{background:rgba(0,0,0,.72)}.gramora-chat-shell{height:100%;height:100dvh;min-height:0;display:flex;flex-direction:column;overflow:hidden;overscroll-behavior:contain}.gramora-chat-messages{overscroll-behavior:contain;overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y}body.gramora-chat-open{overflow:hidden!important;width:100%!important}.gramora-chat-header{height:64px;flex-shrink:0;display:flex;align-items:center;gap:12px;padding:0 14px;border-bottom:1px solid var(--line,#333)}.gramora-chat-back{border:0;background:transparent;color:inherit;font-size:32px;width:34px;cursor:pointer}.gramora-chat-person{display:flex;align-items:center;gap:10px;min-width:0}.gramora-chat-avatar{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;overflow:hidden;background:linear-gradient(135deg,#d85c9a,#8b68dc);font-weight:800}.gramora-chat-avatar img{width:100%;height:100%;object-fit:cover}.gramora-chat-person strong,.gramora-chat-person small{display:block;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gramora-chat-person small{font-size:11px;color:var(--muted,#999);margin-top:2px}.gramora-chat-spacer{flex:1}.gramora-chat-messages{flex:1;min-height:0;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:9px}.gramora-chat-loading{margin:auto;color:var(--muted,#999);font-size:13px}.gramora-chat-bubble{position:relative;max-width:78%;padding:10px 13px;border-radius:16px;background:var(--surface,#272a33);font-size:14px;line-height:1.45;overflow-wrap:anywhere;white-space:pre-wrap}.gramora-chat-bubble.mine{align-self:flex-end;background:linear-gradient(120deg,#d85c9a,#8b68dc);color:white;border-bottom-right-radius:5px}.gramora-chat-bubble.theirs{align-self:flex-start;border-bottom-left-radius:5px}.gramora-chat-empty{margin:auto;text-align:center;color:var(--muted,#999);font-size:13px}.gramora-chat-compose{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line,#333);padding-bottom:max(10px,env(safe-area-inset-bottom))}.gramora-chat-compose input{flex:1;min-width:0;border:1px solid var(--line,#444);border-radius:22px;padding:12px 14px;background:var(--surface,#22252d);color:var(--text,#fff);outline:none}.gramora-chat-compose button[type=submit]{width:44px;height:44px;border:0;border-radius:50%;background:linear-gradient(120deg,#d85c9a,#8b68dc);color:white;font-size:19px;cursor:pointer}.gramora-chat-compose button:disabled{opacity:.5}.gramora-chat-status{color:#31c875!important}.gramora-chat-typing{height:28px;padding:3px 18px 7px;display:flex;align-items:center;gap:4px;color:#31c875}.gramora-chat-typing[hidden]{display:none}.gramora-chat-typing span{width:6px;height:6px;border-radius:50%;background:#31c875;display:block;animation:gramoraTypingDot 1s infinite ease-in-out}.gramora-chat-typing span:nth-child(2){animation-delay:.16s}.gramora-chat-typing span:nth-child(3){animation-delay:.32s}@keyframes gramoraTypingDot{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-5px);opacity:1}}.gramora-chat-replybar{padding:8px 14px;border-left:3px solid #d85c9a;background:var(--surface,#22252d);font-size:12px}.gramora-chat-replybar button{float:right;border:0;background:none;color:inherit}.gramora-chat-quoted{display:block;font-size:11px;opacity:.75;border-left:2px solid currentColor;padding-left:7px;margin-bottom:5px}.gramora-chat-tools{display:flex;gap:10px;justify-content:flex-end;margin-top:5px}.gramora-chat-tools button{font-size:10px;border:0;background:transparent;color:inherit;padding:2px;cursor:pointer}.gramora-chat-bubble img{max-width:210px;max-height:210px;border-radius:10px;display:block}.gramora-sticker-panel{padding:10px;border-top:1px solid var(--line,#333);max-height:48vh;overflow:auto}.gramora-gif-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.gramora-gif-close{border:0;background:transparent;color:inherit;font-size:24px}.gramora-gif-search{width:100%;box-sizing:border-box;padding:11px 13px;border:1px solid var(--line,#444);border-radius:12px;background:var(--surface,#22252d);color:var(--text,#fff);margin-bottom:9px}.gramora-gif-results{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;max-height:190px;overflow:auto}.gramora-gif-results button{padding:0;border:0;border-radius:8px;overflow:hidden;background:#222;min-height:65px}.gramora-gif-results img{display:block;width:100%;height:86px;object-fit:cover}.gramora-giphy-credit{text-align:right;font-size:10px!important}.gramora-chat-bubble .gramora-chat-gif{max-width:220px;max-height:220px;object-fit:contain}.gramora-sticker-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:5px}.gramora-sticker{border:0;background:var(--surface,#252833);border-radius:10px;font-size:24px;padding:7px}.gramora-sticker-panel small{display:block;color:var(--muted,#999);font-size:10px;margin-top:6px}.gramora-chat-replybar[hidden],.gramora-sticker-panel[hidden],.gramora-chat-typing[hidden]{display:none}.gramora-chat-header{background:var(--bg,#101116);box-shadow:0 1px 8px rgba(0,0,0,.08)}.gramora-chat-person{cursor:default}.gramora-chat-avatar{width:42px;height:42px;border:2px solid #d9469a;padding:2px;background-clip:padding-box}.gramora-chat-avatar img{border-radius:50%}.gramora-chat-messages{padding:18px 14px 22px;background:var(--bg,#101116)}.gramora-chat-bubble{max-width:min(78%,340px);padding:11px 15px;border-radius:21px;background:#292b33}.gramora-chat-bubble.mine{background:linear-gradient(135deg,#8b5cf6,#d946a5);border-radius:21px 21px 5px 21px}.gramora-chat-bubble.theirs{border-radius:21px 21px 21px 5px;background:var(--surface,#292b33)}.gramora-chat-compose{align-items:center;gap:9px;padding:10px 13px;background:var(--bg,#101116);border-top:1px solid var(--line,#333)}.gramora-chat-compose input{height:44px;border-radius:24px;padding:0 17px;background:var(--surface,#242630);border:1px solid transparent}.gramora-chat-compose input:focus{border-color:#8b5cf6}.gramora-chat-compose .gramora-chat-sticker-toggle{flex:0 0 38px;width:38px;height:38px;border:0;border-radius:50%;background:transparent;color:var(--text,#fff);font-size:25px;cursor:pointer}.gramora-chat-compose button[type=submit]{width:42px;height:42px;flex:0 0 42px;border-radius:50%;background:transparent;color:#d946a5;font-size:25px}.gramora-chat-tools{opacity:.78}.gramora-chat-replybar{border-radius:12px 12px 0 0;margin:0 10px}.gramora-chat-typing{padding-left:22px}.gramora-message-action-menu{position:absolute;z-index:20;left:50%;top:50%;transform:translate(-50%,-50%);width:min(330px,calc(100% - 32px));padding:14px;background:var(--surface,#242630);border:1px solid var(--line,#444);border-radius:18px;box-shadow:0 14px 45px rgba(0,0,0,.45);display:flex;flex-wrap:wrap;align-items:center;gap:8px}.gramora-message-action-menu strong{width:100%;font-size:12px;color:var(--muted,#aaa)}.gramora-message-react{border:0;border-radius:12px;padding:8px;background:var(--bg,#15161c);font-size:23px}.gramora-message-menu-actions{width:100%;display:flex;gap:7px;flex-wrap:wrap}.gramora-message-menu-actions button{flex:1;min-width:70px;border:1px solid var(--line,#444);border-radius:10px;padding:10px;background:transparent;color:var(--text,#fff)}.gramora-message-menu-actions button:last-child{color:#ff5c79}.gramora-message-menu-close{position:absolute;right:8px;top:7px;border:0;background:transparent;color:var(--text,#fff);font-size:20px}.gramora-chat-reactions{font-size:13px;margin-top:5px;padding:2px 7px;border-radius:12px;background:rgba(120,120,120,.18);width:max-content}.gramora-conversation-right{display:flex;align-items:center;gap:8px;margin-left:auto}.gramora-conversation.has-unread .gramora-conversation-details small{font-weight:800!important;color:#d946a5!important}.gramora-conversation{transition:background .18s ease,transform .18s ease}.gramora-conversation:active{transform:scale(.985);background:var(--surface,#242630)}.gramora-chat-bubble{user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:pan-y}.gramora-chat-bubble *{user-select:none;-webkit-user-select:none}.gramora-chat-dialog,.gramora-chat-shell{transition:background .2s ease,color .2s ease}body.light .gramora-chat-dialog{background:#fff!important;color:#20212a!important}body.light .gramora-chat-header,body.light .gramora-chat-messages,body.light .gramora-chat-compose{background:#fff!important;color:#20212a!important}body.light .gramora-chat-header{border-color:#e6e7ed!important;box-shadow:0 2px 12px rgba(25,30,50,.07)}body.light .gramora-chat-messages{background:#f7f8fc!important}body.light .gramora-chat-bubble.theirs{background:#e9ebf2!important;color:#20212a!important;border:1px solid #e1e3eb}body.light .gramora-chat-bubble.mine{color:#fff!important}body.light .gramora-chat-compose{border-color:#e5e6ec!important}body.light .gramora-chat-compose input,body.light .gramora-gif-search{background:#f1f2f7!important;color:#20212a!important;border-color:#e0e2ea!important}body.light .gramora-chat-compose input::placeholder,body.light .gramora-gif-search::placeholder{color:#777d8c!important}body.light .gramora-chat-replybar,body.light .gramora-sticker-panel{background:#f0f1f6!important;color:#20212a!important;border-color:#e0e2ea!important}body.light .gramora-sticker,body.light .gramora-message-action-menu{background:#fff!important;color:#20212a!important;border-color:#e1e3eb!important}body.light .gramora-message-react{background:#f1f2f7!important}body.light .gramora-message-menu-actions button{color:#20212a!important;border-color:#dfe1e9!important}body.light .gramora-message-menu-close,body.light .gramora-chat-back,body.light .gramora-chat-sticker-toggle{color:#20212a!important}body.light .gramora-chat-quoted{color:#555d70}.gramora-chat-bubble.gramora-gif-message{background:transparent!important;background-image:none!important;padding:0!important;border:0!important;border-radius:0!important;box-shadow:none!important;max-width:min(78%,340px)}.gramora-chat-bubble.gramora-gif-message img.gramora-chat-gif{display:block;background:transparent!important;border:0!important;outline:0!important;box-shadow:none!important;border-radius:12px;max-width:220px;max-height:220px;object-fit:contain}.gramora-chat-bubble.gramora-gif-message .gramora-chat-reactions{margin-top:4px}.gramora-chat-bubble.gramora-gif-message .gramora-chat-quoted{padding:6px 8px;background:var(--surface,#292b33);border-radius:8px}body.light .gramora-chat-bubble.gramora-gif-message .gramora-chat-quoted{background:#e9ebf2}.gramora-chat-more{width:38px;height:38px;border:0;border-radius:50%;background:transparent;color:inherit;font-size:28px;line-height:1;cursor:pointer}.gramora-chat-more:active{background:var(--surface,#292b33)}.gramora-chat-options{position:absolute;z-index:30;right:12px;top:58px;min-width:190px;padding:7px;border:1px solid var(--line,#444);border-radius:15px;background:var(--surface,#252833);box-shadow:0 12px 35px rgba(0,0,0,.28)}.gramora-chat-options[hidden],.gramora-chat-theme-panel[hidden]{display:none}.gramora-chat-options button{width:100%;display:flex;align-items:center;gap:10px;padding:12px;border:0;border-radius:10px;background:transparent;color:var(--text,inherit);text-align:left;font-size:14px}.gramora-chat-options button:active{background:rgba(140,120,180,.18)}.gramora-chat-options .gramora-chat-option-clear{color:#ef6478}.gramora-chat-theme-panel{position:absolute;z-index:31;left:14px;right:14px;top:74px;padding:15px;border:1px solid var(--line,#444);border-radius:18px;background:var(--surface,#252833);box-shadow:0 15px 40px rgba(0,0,0,.32)}.gramora-chat-theme-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.gramora-chat-theme-close{border:0;background:transparent;color:inherit;font-size:25px}.gramora-chat-theme-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.gramora-chat-theme-grid button{display:flex;flex-direction:column;align-items:center;gap:7px;padding:9px 4px;border:1px solid var(--line,#444);border-radius:12px;background:transparent;color:inherit;font-size:12px}.gramora-chat-theme-grid i{display:block;width:100%;height:42px;border-radius:8px;background:linear-gradient(135deg,#8b5cf6,#d946a5)}.gramora-chat-theme-grid [data-chat-theme="love"] i{background:linear-gradient(135deg,#ff5d8f,#ff9a76)}.gramora-chat-theme-grid [data-chat-theme="ocean"] i{background:linear-gradient(135deg,#087ea4,#55c7e8)}.gramora-chat-theme-grid [data-chat-theme="sunset"] i{background:linear-gradient(135deg,#f97316,#f43f5e)}.gramora-chat-theme-grid [data-chat-theme="midnight"] i{background:linear-gradient(135deg,#232946,#6c63ff)}.gramora-chat-theme-grid [data-chat-theme="mint"] i{background:linear-gradient(135deg,#059669,#6ee7b7)}.gramora-chat-shell[data-chat-theme="love"]{background:#fff0f4;color:#512638}.gramora-chat-shell[data-chat-theme="love"] .gramora-chat-messages{background:#fff0f4}.gramora-chat-shell[data-chat-theme="love"] .gramora-chat-bubble.theirs{background:#ffe0e9;color:#512638}.gramora-chat-shell[data-chat-theme="love"] .gramora-chat-bubble.mine{background:linear-gradient(135deg,#ff5d8f,#ff9a76)}.gramora-chat-shell[data-chat-theme="ocean"]{background:#eaf8ff;color:#12384a}.gramora-chat-shell[data-chat-theme="ocean"] .gramora-chat-messages{background:#eaf8ff}.gramora-chat-shell[data-chat-theme="ocean"] .gramora-chat-bubble.theirs{background:#cceefa;color:#12384a}.gramora-chat-shell[data-chat-theme="ocean"] .gramora-chat-bubble.mine{background:linear-gradient(135deg,#087ea4,#55c7e8)}.gramora-chat-shell[data-chat-theme="sunset"]{background:#fff3e8;color:#512d20}.gramora-chat-shell[data-chat-theme="sunset"] .gramora-chat-messages{background:#fff3e8}.gramora-chat-shell[data-chat-theme="sunset"] .gramora-chat-bubble.theirs{background:#ffe0c7;color:#512d20}.gramora-chat-shell[data-chat-theme="sunset"] .gramora-chat-bubble.mine{background:linear-gradient(135deg,#f97316,#f43f5e)}.gramora-chat-shell[data-chat-theme="midnight"]{background:#171a35;color:#f3f3ff}.gramora-chat-shell[data-chat-theme="midnight"] .gramora-chat-messages{background:#171a35}.gramora-chat-shell[data-chat-theme="midnight"] .gramora-chat-bubble.theirs{background:#292e55;color:#f3f3ff}.gramora-chat-shell[data-chat-theme="midnight"] .gramora-chat-bubble.mine{background:linear-gradient(135deg,#4f46e5,#8b5cf6)}.gramora-chat-shell[data-chat-theme="mint"]{background:#eafaf2;color:#174333}.gramora-chat-shell[data-chat-theme="mint"] .gramora-chat-messages{background:#eafaf2}.gramora-chat-shell[data-chat-theme="mint"] .gramora-chat-bubble.theirs{background:#cceedd;color:#174333}.gramora-chat-shell[data-chat-theme="mint"] .gramora-chat-bubble.mine{background:linear-gradient(135deg,#059669,#34d399)}.gramora-chat-shell[data-chat-theme="love"] .gramora-chat-compose,.gramora-chat-shell[data-chat-theme="ocean"] .gramora-chat-compose,.gramora-chat-shell[data-chat-theme="sunset"] .gramora-chat-compose,.gramora-chat-shell[data-chat-theme="mint"] .gramora-chat-compose{border-color:rgba(0,0,0,.12)}.gramora-chat-shell[data-chat-theme="love"] .gramora-chat-compose input,.gramora-chat-shell[data-chat-theme="ocean"] .gramora-chat-compose input,.gramora-chat-shell[data-chat-theme="sunset"] .gramora-chat-compose input,.gramora-chat-shell[data-chat-theme="mint"] .gramora-chat-compose input{background:rgba(255,255,255,.78);color:#222;border-color:rgba(0,0,0,.15)}.gramora-chat-shell[data-chat-theme="love"] .gramora-chat-header,.gramora-chat-shell[data-chat-theme="ocean"] .gramora-chat-header,.gramora-chat-shell[data-chat-theme="sunset"] .gramora-chat-header,.gramora-chat-shell[data-chat-theme="mint"] .gramora-chat-header{border-color:rgba(0,0,0,.12)}.gramora-chat-shell[data-chat-theme="love"] .gramora-chat-status,.gramora-chat-shell[data-chat-theme="ocean"] .gramora-chat-status,.gramora-chat-shell[data-chat-theme="sunset"] .gramora-chat-status,.gramora-chat-shell[data-chat-theme="mint"] .gramora-chat-status{color:#16845b!important}';
      style.textContent += '#gramoraChatDialog{isolation:isolate!important;background:#fff!important}#gramoraChatDialog .gramora-chat-shell{position:relative;isolation:isolate;background:#fff!important;z-index:1}#gramoraChatDialog .gramora-chat-header{position:relative;z-index:2}#gramoraChatDialog .gramora-chat-messages{position:relative;z-index:1}body:not(.light) #gramoraChatDialog{background:#101116!important}body:not(.light) #gramoraChatDialog .gramora-chat-shell{background:#101116!important}body.light #gramoraChatDialog,body.light #gramoraChatDialog .gramora-chat-shell{background:#fff!important}';
style.textContent += '.gramora-chat-find-panel{position:absolute;z-index:40;inset:64px 10px auto;padding:14px;border:1px solid var(--line,#444);border-radius:16px;background:var(--surface,#252833);box-shadow:0 12px 35px rgba(0,0,0,.35);max-height:70%;display:flex;flex-direction:column;gap:10px}.gramora-chat-find-head{display:flex;justify-content:space-between;align-items:center}.gramora-chat-find-head button{border:0;background:transparent;color:inherit;font-size:24px}.gramora-chat-find-panel input{width:100%;padding:12px;border:1px solid var(--line,#555);border-radius:10px;background:var(--bg,#111);color:var(--text,white)}.gramora-chat-find-results{overflow:auto;display:flex;flex-direction:column;gap:7px;font-size:13px}.gramora-chat-find-result{display:flex;flex-direction:column;gap:4px;text-align:left;padding:10px;border:1px solid var(--line,#444);border-radius:9px;background:transparent;color:inherit}.gramora-chat-find-result small{opacity:.65}.gramora-chat-search-hit{padding:10px;margin:8px;border:2px solid #8b5cf6;border-radius:10px;background:var(--surface,#333);color:var(--text,white)}';
      document.head.append(style);
    }
    if(!document.getElementById("gramora-chat-message-row-style")){
      const rowStyle=document.createElement("style");
      rowStyle.id="gramora-chat-message-row-style";
      rowStyle.textContent=".gramora-message-row{width:100%;min-width:0;display:flex;flex-direction:column;align-items:flex-start;position:relative;touch-action:pan-y;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}.gramora-message-row.mine{align-items:flex-end}.gramora-message-row.theirs{align-items:flex-start}.gramora-message-row .gramora-chat-bubble{max-width:min(78%,340px)}.gramora-message-row .gramora-message-receipt{align-self:flex-end;display:block;margin-top:4px!important;margin-right:5px;line-height:1.25;padding:0 2px;position:static;clear:both}";
      document.head.append(rowStyle);
    }
    const chatShell=dlg.querySelector(".gramora-chat-shell");
    const chatOptions=dlg.querySelector(".gramora-chat-options");
    const chatThemePanel=dlg.querySelector(".gramora-chat-theme-panel");
    const chatThemeKey="gramora-chat-theme:"+viewer.uid+":"+targetUid;
    const chatThemeStyles={
      default:{page:"var(--bg,#101116)",incoming:"var(--surface,#292b33)",text:"var(--text,#fff)",input:"var(--surface,#242630)",mine:"linear-gradient(135deg,#8b5cf6,#d946a5)",menu:"rgba(35,38,50,.97)",menuBorder:"#8b5cf6",accent:"#a78bfa"},
      love:{page:"#fff0f4",incoming:"#ffe0e9",text:"#512638",input:"#fff",mine:"linear-gradient(135deg,#ff5d8f,#ff9a76)",menu:"rgba(255,235,241,.98)",menuBorder:"#ff7ca8",accent:"#e84379"},
      ocean:{page:"#eaf8ff",incoming:"#cceefa",text:"#12384a",input:"#fff",mine:"linear-gradient(135deg,#087ea4,#55c7e8)",menu:"rgba(225,246,255,.98)",menuBorder:"#35a9d0",accent:"#087ea4"},
      sunset:{page:"#fff3e8",incoming:"#ffe0c7",text:"#512d20",input:"#fff",mine:"linear-gradient(135deg,#f97316,#f43f5e)",menu:"rgba(255,237,222,.98)",menuBorder:"#fb7b45",accent:"#e85b2a"},
      midnight:{page:"#171a35",incoming:"#292e55",text:"#f3f3ff",input:"#24294a",mine:"linear-gradient(135deg,#4f46e5,#8b5cf6)",menu:"rgba(31,35,69,.98)",menuBorder:"#7770ff",accent:"#aaa5ff"},
      mint:{page:"#eafaf2",incoming:"#cceedd",text:"#174333",input:"#fff",mine:"linear-gradient(135deg,#059669,#34d399)",menu:"rgba(226,249,237,.98)",menuBorder:"#39ad7a",accent:"#07865c"}
    };
    if(!document.getElementById("gramora-chat-theme-fix")){
      const themeStyle=document.createElement("style");themeStyle.id="gramora-chat-theme-fix";
      themeStyle.textContent='#gramoraChatDialog .gramora-chat-options,#gramoraChatDialog .gramora-chat-theme-panel{background:var(--gramora-theme-menu)!important;border:1.5px solid var(--gramora-theme-menu-border)!important;color:var(--gramora-theme-text)!important;box-shadow:0 14px 38px rgba(0,0,0,.22),0 0 0 1px var(--gramora-theme-accent),0 0 22px var(--gramora-theme-accent)!important;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);animation:gramoraMenuPop .18s ease-out}#gramoraChatDialog .gramora-chat-options button{color:var(--gramora-theme-text)!important;font-weight:650;border:1px solid transparent;transition:background .18s ease,transform .18s ease,border-color .18s ease}#gramoraChatDialog .gramora-chat-options button:hover,#gramoraChatDialog .gramora-chat-options button:focus-visible{background:var(--gramora-theme-accent)!important;color:#fff!important;border-color:var(--gramora-theme-menu-border)!important;transform:translateX(2px);outline:none}#gramoraChatDialog .gramora-chat-options button:active{transform:scale(.98)}#gramoraChatDialog .gramora-chat-options .gramora-chat-option-clear{color:#e34d67!important}#gramoraChatDialog .gramora-chat-options .gramora-chat-option-clear:hover{background:#e34d67!important;color:#fff!important}#gramoraChatDialog .gramora-chat-theme-grid button{color:var(--gramora-theme-text)!important;border-color:var(--gramora-theme-menu-border)!important;background:rgba(255,255,255,.12);transition:transform .18s ease,box-shadow .18s ease}#gramoraChatDialog .gramora-chat-theme-grid button.active,#gramoraChatDialog .gramora-chat-theme-grid button:hover{transform:translateY(-2px);box-shadow:0 0 0 2px var(--gramora-theme-accent),0 8px 18px rgba(0,0,0,.15)}#gramoraChatDialog .gramora-chat-theme-title{color:var(--gramora-theme-text)!important}#gramoraChatDialog .gramora-chat-theme-close{color:var(--gramora-theme-text)!important}#gramoraChatDialog .gramora-chat-options button{min-height:44px}#gramoraChatDialog .gramora-chat-options button svg{width:20px;height:20px;flex:0 0 20px;display:block;stroke:currentColor}#gramoraChatDialog .gramora-chat-options button span{display:block}body.light #gramoraChatDialog .gramora-chat-options,body.light #gramoraChatDialog .gramora-chat-theme-panel{background:rgba(255,255,255,.98)!important;border-color:#e1e3eb!important;color:#20212a!important;box-shadow:0 10px 30px rgba(25,30,50,.14)!important;backdrop-filter:blur(16px)}body.light #gramoraChatDialog .gramora-chat-options button{color:#262833!important}body.light #gramoraChatDialog .gramora-chat-options .gramora-chat-option-clear{color:#e34d67!important}@keyframes gramoraMenuPop{from{opacity:0;transform:translateY(-6px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}#gramoraChatDialog .gramora-chat-shell[data-chat-theme] .gramora-chat-messages,#gramoraChatDialog .gramora-chat-shell[data-chat-theme] .gramora-chat-header,#gramoraChatDialog .gramora-chat-shell[data-chat-theme] .gramora-chat-compose{background:var(--gramora-theme-page)!important;color:var(--gramora-theme-text)!important}#gramoraChatDialog .gramora-chat-shell[data-chat-theme] .gramora-chat-bubble.theirs{background:var(--gramora-theme-incoming)!important;color:var(--gramora-theme-text)!important;border-color:transparent!important}#gramoraChatDialog .gramora-chat-shell[data-chat-theme] .gramora-chat-bubble.mine{background:var(--gramora-theme-mine)!important;color:#fff!important}#gramoraChatDialog .gramora-chat-shell[data-chat-theme] .gramora-chat-compose input{background:var(--gramora-theme-input)!important;color:var(--gramora-theme-text)!important;border-color:rgba(120,120,140,.25)!important}#gramoraChatDialog .gramora-chat-shell[data-chat-theme] .gramora-chat-back,#gramoraChatDialog .gramora-chat-shell[data-chat-theme] .gramora-chat-more,#gramoraChatDialog .gramora-chat-shell[data-chat-theme] .gramora-chat-sticker-toggle{color:var(--gramora-theme-text)!important}#gramoraChatDialog .gramora-chat-shell[data-chat-theme] .gramora-chat-status{color:#16845b!important}#gramoraChatDialog .gramora-chat-shell[data-chat-theme="midnight"] .gramora-chat-messages,#gramoraChatDialog .gramora-chat-shell[data-chat-theme="midnight"] .gramora-chat-header,#gramoraChatDialog .gramora-chat-shell[data-chat-theme="midnight"] .gramora-chat-compose{background:#171a35!important;color:#f3f3ff!important}';
      document.head.append(themeStyle);
    }
    function applyChatTheme(theme){
      const safeTheme=Object.prototype.hasOwnProperty.call(chatThemeStyles,theme)?theme:"default";
      const palette={...(chatThemeStyles[safeTheme]||chatThemeStyles.default)};
      // The default incoming bubble must stay light with dark text in light mode.
      if(safeTheme==="default"&&document.body.classList.contains("light")){
        palette.page="#f7f8fc";palette.incoming="#e9ebf2";palette.text="#20212a";palette.input="#f1f2f7";
        palette.menu="rgba(255,255,255,.98)";palette.menuBorder="#e1e3eb";palette.accent="#8b5cf6";
      }
      chatShell.dataset.chatTheme=safeTheme;
      chatShell.style.setProperty("--gramora-theme-page",palette.page);
      chatShell.style.setProperty("--gramora-theme-incoming",palette.incoming);
      chatShell.style.setProperty("--gramora-theme-text",palette.text);
      chatShell.style.setProperty("--gramora-theme-input",palette.input);
      chatShell.style.setProperty("--gramora-theme-mine",palette.mine);
      chatShell.style.setProperty("--gramora-theme-menu",palette.menu);
      chatShell.style.setProperty("--gramora-theme-menu-border",palette.menuBorder);
      chatShell.style.setProperty("--gramora-theme-accent",palette.accent);
      chatShell.querySelector(".gramora-chat-messages").style.setProperty("background",palette.page,"important");
      chatShell.querySelector(".gramora-chat-header").style.setProperty("background",palette.page,"important");
      chatShell.querySelector(".gramora-chat-compose").style.setProperty("background",palette.page,"important");
      chatShell.querySelector(".gramora-chat-compose input").style.setProperty("background",palette.input,"important");
      chatShell.querySelector(".gramora-chat-compose input").style.setProperty("color",palette.text,"important");
      chatShell.querySelectorAll(".gramora-chat-theme-grid [data-chat-theme]").forEach(button=>button.classList.toggle("active",button.dataset.chatTheme===safeTheme));
    }
    const savedChatTheme=localStorage.getItem(chatThemeKey)||"default";
    applyChatTheme(savedChatTheme);
    dlg.querySelector(".gramora-chat-more").addEventListener("click",()=>{chatOptions.hidden=!chatOptions.hidden;chatThemePanel.hidden=true;});
    dlg.querySelector(".gramora-chat-option-theme").addEventListener("click",()=>{chatOptions.hidden=true;chatThemePanel.hidden=false;});
    dlg.querySelector(".gramora-chat-theme-close").addEventListener("click",()=>chatThemePanel.hidden=true);
    dlg.querySelectorAll(".gramora-chat-theme-grid [data-chat-theme]").forEach(button=>button.addEventListener("click",()=>{
      const theme=button.dataset.chatTheme;
      applyChatTheme(theme);
      try{localStorage.setItem(chatThemeKey,theme);}catch(error){console.warn("Chat theme could not be saved:",error);}
      chatThemePanel.hidden=true;
    }));
    dlg.querySelector(".gramora-chat-option-find").addEventListener("click",async()=>{
      chatOptions.hidden=true;
      const panel=document.createElement("section");panel.className="gramora-chat-find-panel";
      panel.innerHTML='<div class="gramora-chat-find-head"><strong>Find in chats</strong><button type="button" aria-label="Close">×</button></div><input type="search" maxlength="100" placeholder="Search messages…"><div class="gramora-chat-find-results">Type a word or phrase to search this conversation.</div>';
      chatShell.append(panel);
      const close=panel.querySelector("button"),field=panel.querySelector("input"),results=panel.querySelector(".gramora-chat-find-results");
      close.onclick=()=>panel.remove();
      let searchToken=0,searchTimer=null;
      field.focus();
      field.addEventListener("input",()=>{
        clearTimeout(searchTimer);
        searchTimer=setTimeout(async()=>{
          const term=field.value.trim().toLocaleLowerCase(),token=++searchToken;
          if(!term){results.textContent="Type a word or phrase to search this conversation.";return;}
          results.textContent="Searching full chat history…";
          try{
            const base=collection(db,"conversations",conversationRef.id,"messages");
            let pageQuery=query(base,orderBy("createdAt","desc"),limit(100)),cursor=null,found=[],scanned=0,hasMore=true;
            while(hasMore&&scanned<10000){
              const page=await getDocs(cursor?query(base,orderBy("createdAt","desc"),startAfter(cursor),limit(100)):pageQuery);
              if(token!==searchToken)return;
              if(page.empty)break;
              for(const item of page.docs){
                const data=item.data(),haystack=[data.text,data.replyToText,data.type==="gif"?"GIF":"",data.type==="sticker"?"sticker":""].join(" ").toLocaleLowerCase();
                if(haystack.includes(term))found.push({id:item.id,data,ref:item.ref});
              }
              scanned+=page.size;cursor=page.docs[page.docs.length-1];hasMore=page.size===100;
              if(found.length>=100)break;
            }
            if(token!==searchToken)return;
            results.replaceChildren();
            if(!found.length){results.textContent=scanned>=10000?"No match in the latest 10,000 messages.":"No matching messages found.";return;}
            const note=document.createElement("small");note.textContent=found.length+" result(s) · searched "+scanned+" messages";results.append(note);
            found.forEach(match=>{
              const row=document.createElement("button");row.type="button";row.className="gramora-chat-find-result";
              const body=document.createElement("span");body.textContent=match.data.type==="gif"?"GIF":match.data.text||"Sticker";
              const date=document.createElement("small");date.textContent=match.data.createdAt?.toDate?.().toLocaleString?.()||"";
              row.append(body,date);row.onclick=()=>{
                panel.remove();
                const marker=document.createElement("div");marker.className="gramora-chat-search-hit";marker.textContent="Found message: "+(match.data.text||match.data.type||"Message");
                messageBox.prepend(marker);marker.scrollIntoView({behavior:"smooth",block:"center"});
                setTimeout(()=>marker.remove(),5000);
              };results.append(row);
            });
          }catch(error){console.error("Find in chats failed:",error);results.textContent="Search failed. Check your connection and Firestore Rules.";}
        },350);
      });
    });
    dlg.querySelector(".gramora-chat-option-clear").addEventListener("click",()=>{
      chatOptions.hidden=true;
      if(!confirm("Clear this chat from your account only? The other person will still see all messages."))return;
      try{
        const clearKey="gramora-chat-cleared:"+viewer.uid+":"+conversationRef.id;
        localStorage.setItem(clearKey,String(Date.now()));
        messageBox.replaceChildren();
        const empty=document.createElement("p");empty.className="gramora-chat-empty";empty.textContent="Chat cleared for you. New messages will appear here.";messageBox.append(empty);
        chatOptions.hidden=true;chatThemePanel.hidden=true;
        alert("Chat cleared from your account. The other person’s chat is unchanged.");
      }catch(error){
        console.error("Local chat clear failed:",error);
        alert("Chat clear nahi ho payi. Device storage check karein.");
      }
    });
    dlg.querySelector(".gramora-chat-back").addEventListener("click",closeGramoraChat);
    if(!dlg.open){document.body.classList.add("gramora-chat-open");dlg.showModal();}
    const conversations=await getDocs(query(collection(db,"conversations"),where("participantUids","array-contains",viewer.uid)));
    const existing=conversations.docs.find(d=>(d.data().participantUids||[]).includes(targetUid));
    let conversationRef;
    if(existing)conversationRef=existing.ref;
    else conversationRef=await addDoc(collection(db,"conversations"),{participantUids:[viewer.uid,targetUid],createdBy:viewer.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),lastMessage:"",lastMessageAt:serverTimestamp(),lastMessageSenderUid:viewer.uid});
    activeChatConversationId=conversationRef.id;
    let conversationRefSnapshotLastMessage="";
    const conversationMeta=await getDoc(conversationRef);conversationRefSnapshotLastMessage=conversationMeta.exists()?conversationMeta.data().lastMessage||"":"";
    clearGramoraInboxUnread(conversationRef.id,conversationRefSnapshotLastMessage);
    const messageBox=dlg.querySelector(".gramora-chat-messages"),sendForm=dlg.querySelector(".gramora-chat-compose"),input=sendForm.querySelector("input");
    input.blur();
    input.addEventListener("click",()=>input.focus());
    const replyBar=dlg.querySelector(".gramora-chat-replybar"),stickerPanel=dlg.querySelector(".gramora-sticker-panel");
    function setReply(message){chatReplyTarget=message;chatEditTarget=null;replyBar.hidden=false;replyBar.textContent="Replying to: "+(message.text||"Sticker/GIF");const close=document.createElement("button");close.type="button";close.textContent="×";close.addEventListener("click",()=>{chatReplyTarget=null;replyBar.hidden=true;});replyBar.append(close);input.focus();}
    function setEdit(message){chatEditTarget=message;chatReplyTarget=null;replyBar.hidden=false;replyBar.textContent="Editing your message";const close=document.createElement("button");close.type="button";close.textContent="×";close.addEventListener("click",()=>{chatEditTarget=null;replyBar.hidden=true;input.value="";});replyBar.append(close);input.value=message.text||"";input.focus();}
    function showMessageActions(message,mine,bubble){
      dlg.querySelector(".gramora-message-action-menu")?.remove();
      const menu=document.createElement("div");menu.className="gramora-message-action-menu";
      const heading=document.createElement("strong");heading.textContent="React";menu.append(heading);
      ["❤️","😂","😮","😢","🔥","👍","👏","😍"].forEach(emoji=>{
        const react=document.createElement("button");react.type="button";react.className="gramora-message-react";react.textContent=emoji;
        react.addEventListener("click",async()=>{
          try{
            const reactions={...(message.reactions||{})};
            if(reactions[viewer.uid]===emoji)delete reactions[viewer.uid];else reactions[viewer.uid]=emoji;
            await updateDoc(doc(db,"conversations",conversationRef.id,"messages",message.id),{reactions});
          }catch(error){console.error("Message reaction failed:",error);alert("Reaction save nahi hui. Latest Firestore Rules publish karein.");}
          menu.remove();
        });menu.append(react);
      });
      const actions=document.createElement("div");actions.className="gramora-message-menu-actions";
      const addAction=(label,handler)=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.addEventListener("click",()=>{menu.remove();handler();});actions.append(b);};
      addAction("Reply",()=>setReply(message));
      if(mine&&message.type==="text")addAction("Edit",()=>setEdit(message));
      if(mine)addAction("Unsend",async()=>{
        if(!confirm("Is message ko dono taraf se unsend karna hai?"))return;
        try{
          await deleteDoc(doc(db,"conversations",conversationRef.id,"messages",message.id));
          const preview=message.type==="gif"?"GIF":(message.text||"");
          if((conversationRefSnapshotLastMessage||"")===preview){
            await updateDoc(conversationRef,{lastMessage:"Message unsent",lastMessageAt:serverTimestamp(),lastMessageSenderUid:viewer.uid,updatedAt:serverTimestamp()});
          }
        }catch(error){console.error("Unsend failed:",error);alert("Message unsend nahi hua. Latest Firestore Rules publish karein.");}
      });
      menu.append(actions);
      const close=document.createElement("button");close.type="button";close.className="gramora-message-menu-close";close.textContent="×";close.setAttribute("aria-label","Close");close.addEventListener("click",()=>menu.remove());menu.append(close);
      dlg.querySelector(".gramora-chat-shell").append(menu);
    }
    async function sendPayload(payload,preview){
      await addDoc(collection(db,"conversations",conversationRef.id,"messages"),{senderUid:viewer.uid,...payload,status:"sent",createdAt:serverTimestamp()});
      await updateDoc(conversationRef,{lastMessage:preview,lastMessageAt:serverTimestamp(),lastMessageSenderUid:viewer.uid,updatedAt:serverTimestamp()});
    }
    function stopTyping(){if(chatTypingStopTimer)clearTimeout(chatTypingStopTimer);deleteDoc(doc(db,"conversations",conversationRef.id,"typing",viewer.uid)).catch(()=>{});}
    const composerSend=sendForm.querySelector('button[type="submit"]');
    const updateComposerState=()=>{if(composerSend)composerSend.hidden=!input.value.trim();};
    updateComposerState();
    input.addEventListener("input",updateComposerState);
    input.addEventListener("input",()=>{
      setDoc(doc(db,"conversations",conversationRef.id,"typing",viewer.uid),{uid:viewer.uid,typing:true,updatedAt:serverTimestamp()}).catch(()=>{});
      if(chatTypingStopTimer)clearTimeout(chatTypingStopTimer);chatTypingStopTimer=setTimeout(stopTyping,1800);
    });
    activeChatTypingUnsubscribe=onSnapshot(collection(db,"conversations",conversationRef.id,"typing"),snap=>{
      const typing=snap.docs.some(d=>d.id===targetUid&&d.data().typing===true);
      dlg.querySelector(".gramora-chat-typing").hidden=!typing;
    },()=>{});
    activeChatPresenceUnsubscribe=onSnapshot(doc(db,"userPresence",targetUid),snap=>{
      activeChatPresenceData=snap.exists()?snap.data():{};
      renderGramoraChatPresence(dlg.querySelector(".gramora-chat-status"),activeChatPresenceData);
    },()=>{dlg.querySelector(".gramora-chat-status").textContent="Status unavailable";});
    if(activeChatPresenceTimer)clearInterval(activeChatPresenceTimer);
    activeChatPresenceTimer=setInterval(()=>renderGramoraChatPresence(dlg.querySelector(".gramora-chat-status"),activeChatPresenceData),15000);
    activeChatUnsubscribe=onSnapshot(query(collection(db,"conversations",conversationRef.id,"messages"),orderBy("createdAt","desc"),limit(500)),snapshot=>{
      if(!dlg.open||activeChatConversationId!==conversationRef.id)return;
      messageBox.replaceChildren();
      // Hide messages at or before this user's local clear timestamp; never delete shared messages.
      const clearedAt=Number(localStorage.getItem("gramora-chat-cleared:"+viewer.uid+":"+conversationRef.id)||0);
      const visibleMessageDocs=snapshot.docs.filter(item=>(item.data().createdAt?.toMillis?.()||0)>clearedAt);
      const orderedMessageDocs=[...visibleMessageDocs].reverse();
      const latestOwnMessageId=visibleMessageDocs.find(item=>item.data().senderUid===viewer.uid)?.id||null;
      // Mark only visible incoming messages as seen while this conversation is open.
      orderedMessageDocs.forEach(messageDoc=>{
        const data=messageDoc.data();
        if(data.senderUid!==viewer.uid&&data.status!=="seen"){
          updateDoc(messageDoc.ref,{status:"seen",seenAt:serverTimestamp()}).catch(error=>console.warn("Message seen status failed:",error));
        }
      });
      conversationRefSnapshotLastMessage=visibleMessageDocs.length?(visibleMessageDocs[0].data().text||""):"";
      if(!visibleMessageDocs.length){const empty=document.createElement("p");empty.className="gramora-chat-empty";empty.textContent=clearedAt?"Chat cleared for you. New messages will appear here.":"Start your conversation 👋";messageBox.append(empty);}
      orderedMessageDocs.forEach(messageDoc=>{
        const m={id:messageDoc.id,...messageDoc.data()},mine=m.senderUid===viewer.uid;
        const bubble=document.createElement("div");bubble.className="gramora-chat-bubble "+(mine?"mine":"theirs")+(m.type==="gif"?" gramora-gif-message":"");
        if(m.replyToText){const quoted=document.createElement("span");quoted.className="gramora-chat-quoted";quoted.textContent="↪ "+m.replyToText;bubble.append(quoted);}
        if(m.type==="sticker"){bubble.style.fontSize="42px";bubble.textContent=m.text||"❤️";}
        else if(m.type==="gif"&&(m.gifUrl||m.gifData)){const img=document.createElement("img");img.className="gramora-chat-gif";img.src=m.gifUrl||m.gifData;img.alt="GIF";img.loading="lazy";img.style.cssText="border:0;outline:0;box-shadow:none";bubble.append(img);}
        else bubble.append(document.createTextNode(m.text||""));
        if(m.editedAt){const edited=document.createElement("small");edited.textContent=" · edited";edited.style.fontSize="9px";bubble.append(edited);}
        const reactionValues=Object.values(m.reactions||{}).filter(Boolean);
        if(reactionValues.length){const reactionLine=document.createElement("div");reactionLine.className="gramora-chat-reactions";reactionLine.textContent=[...new Set(reactionValues)].join(" ");bubble.append(reactionLine);}
        const messageRow=document.createElement("div");
        messageRow.className="gramora-message-row "+(mine?"mine":"theirs");
        let holdTimer=null,holdTriggered=false;
        const openActions=()=>showMessageActions(m,mine,bubble);
        let swipeStartX=0,swipeStartY=0,swipeHandled=false;
        bubble.addEventListener("pointerdown",()=>{holdTriggered=false;holdTimer=setTimeout(()=>{holdTriggered=true;openActions();},550);});
        ["pointerup","pointerleave","pointercancel"].forEach(type=>bubble.addEventListener(type,()=>{if(holdTimer)clearTimeout(holdTimer);}));
        messageRow.addEventListener("touchstart",event=>{const touch=event.changedTouches[0];swipeStartX=touch.clientX;swipeStartY=touch.clientY;swipeHandled=false;},{passive:true});
        messageRow.addEventListener("touchend",event=>{const touch=event.changedTouches[0],dx=touch.clientX-swipeStartX,dy=touch.clientY-swipeStartY;if(dx>58&&Math.abs(dy)<58&&!holdTriggered){swipeHandled=true;if(holdTimer)clearTimeout(holdTimer);setReply(m);bubble.animate([{transform:"translateX(0)"},{transform:"translateX(9px)"},{transform:"translateX(0)"}],{duration:180});}},{passive:true});
        messageRow.addEventListener("contextmenu",event=>{event.preventDefault();openActions();});
        bubble.addEventListener("selectstart",event=>event.preventDefault());
        messageRow.append(bubble);
        messageBox.append(messageRow);
        if(mine&&m.id===latestOwnMessageId){
          const receipt=document.createElement("small");
          receipt.className="gramora-message-receipt";
          const seenDate=m.seenAt?.toDate?.();
          if(m.status==="seen"&&seenDate){
            const elapsed=Math.max(0,Date.now()-seenDate.getTime()),minutes=Math.floor(elapsed/60000),hours=Math.floor(elapsed/3600000),days=Math.floor(elapsed/86400000);
            const ago=minutes<1?"just now":hours<1?minutes+" min ago":days<1?hours+" hr ago":days+" day"+(days===1?"":"s")+" ago";
            receipt.textContent="Seen "+ago;
          }else receipt.textContent=m.status==="seen"?"Seen":"Sent";
          receipt.style.cssText="display:block;align-self:flex-end;text-align:right;font-size:10px;line-height:1.2;opacity:.78;margin-top:4px;margin-right:5px;padding:0 2px;color:var(--muted,#999)";
          messageRow.append(receipt);
        }
      });
      messageBox.scrollTop=messageBox.scrollHeight;
    },error=>{console.error("GRAMORA chat listener:",error);messageBox.textContent="Chat load nahi ho paayi. Firestore Rules check karein.";});
    sendForm.onsubmit=async event=>{
      event.preventDefault();const text=input.value.trim();if(!text)return;
      const button=sendForm.querySelector("button[type=submit]");button.disabled=true;
      try{
        if(chatEditTarget){
          await updateDoc(doc(db,"conversations",conversationRef.id,"messages",chatEditTarget.id),{text,editedAt:serverTimestamp()});
          await updateDoc(conversationRef,{lastMessage:text,lastMessageAt:serverTimestamp(),lastMessageSenderUid:viewer.uid,updatedAt:serverTimestamp()});
          chatEditTarget=null;replyBar.hidden=true;
        }else{
          const payload={text,type:"text"};
          if(chatReplyTarget){payload.replyToId=chatReplyTarget.id;payload.replyToText=chatReplyTarget.text||"Sticker/GIF";}
          await sendPayload(payload,text);
          chatReplyTarget=null;replyBar.hidden=true;
        }
        input.value="";updateComposerState();stopTyping();input.focus();
      }catch(error){console.error("GRAMORA send/edit message:",error);alert("Message save nahi hua. Latest Firestore Rules publish karein.");}
      finally{button.disabled=false;}
    };
    const gifResults=dlg.querySelector(".gramora-gif-results"),gifSearch=dlg.querySelector(".gramora-gif-search");
    const GIPHY_API_KEY="gAwFmSFXNfQNrWlPqAQlYpjZ1oFNOBem";
    let gifSearchTimer=null,gifRequestToken=0;
    async function loadGramoraGifs(term=""){
      const token=++gifRequestToken;
      gifResults.textContent="Loading GIFs…";
      try{
        const endpoint=term?"search":"trending";
        const params=new URLSearchParams({api_key:GIPHY_API_KEY,limit:"18",rating:"g"});
        if(term)params.set("q",term.slice(0,50));
        const response=await fetch("https://api.giphy.com/v1/gifs/"+endpoint+"?"+params.toString());
        if(!response.ok)throw new Error("GIPHY API "+response.status);
        const result=await response.json();
        if(token!==gifRequestToken)return;
        gifResults.replaceChildren();
        (result.data||[]).forEach(item=>{
          const url=item.images?.fixed_height?.url||item.images?.downsized?.url;
          const preview=item.images?.fixed_height_small?.url||url;
          if(!url)return;
          const pick=document.createElement("button");pick.type="button";pick.title="Send GIF";
          const image=document.createElement("img");image.src=preview;image.alt=item.title||"GIF";image.loading="lazy";pick.append(image);
          pick.addEventListener("click",async()=>{
            pick.disabled=true;
            try{await sendPayload({text:"GIF",type:"gif",gifUrl:url},"GIF");stickerPanel.hidden=true;}
            catch(error){console.error("GIF send failed",error);alert("GIF send nahi hua. Firestore Rules publish karein.");}
            finally{pick.disabled=false;}
          });
          gifResults.append(pick);
        });
        if(!gifResults.children.length)gifResults.textContent="No GIFs found. Try another search.";
      }catch(error){console.error("GIPHY search failed",error);if(token===gifRequestToken)gifResults.textContent="GIFs load nahi hue. API Key ya internet connection check karein.";}
    }
    dlg.querySelector(".gramora-chat-sticker-toggle").addEventListener("click",()=>{
      stickerPanel.hidden=!stickerPanel.hidden;
      if(!stickerPanel.hidden&&!gifResults.dataset.loaded){gifResults.dataset.loaded="1";loadGramoraGifs();}
    });
    dlg.querySelector(".gramora-gif-close").addEventListener("click",()=>{stickerPanel.hidden=true;});
    gifSearch.addEventListener("input",()=>{
      if(gifSearchTimer)clearTimeout(gifSearchTimer);
      gifSearchTimer=setTimeout(()=>{const term=gifSearch.value.trim();if(term)loadGramoraGifs(term);else loadGramoraGifs();},350);
    });
    gifSearch.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();if(gifSearchTimer)clearTimeout(gifSearchTimer);loadGramoraGifs(gifSearch.value.trim());}});

    dlg.querySelectorAll(".gramora-sticker").forEach(button=>button.addEventListener("click",async()=>{
      try{await sendPayload({text:button.dataset.sticker,type:"sticker"}, "Sticker "+button.dataset.sticker);stickerPanel.hidden=true;}
      catch(error){console.error(error);alert("Sticker send nahi hua. Latest Firestore Rules publish karein.");}
    }));
    input.addEventListener("paste",event=>{
      const items=event.clipboardData?.items;
      if(!items)return;
      const gifItem=Array.from(items).find(item=>item.kind==="file"&&item.type==="image/gif");
      if(!gifItem)return;
      event.preventDefault();
      const file=gifItem.getAsFile();
      if(!file)return;
      if(file.size>500000){alert("GIF 500 KB se chhoti honi chahiye. Chhoti GIF paste karein.");return;}
      const reader=new FileReader();
      reader.onload=async()=>{
        try{await sendPayload({text:"GIF",type:"gif",gifData:String(reader.result)},"GIF");stickerPanel.hidden=true;}
        catch(error){console.error(error);alert("GIF send nahi hua. Latest Firestore Rules publish karein.");}
      };
      reader.onerror=()=>alert("GIF read nahi ho paayi.");
      reader.readAsDataURL(file);
    });
  }catch(error){console.error("Could not open GRAMORA chat:",error);alert("Chat open nahi ho paayi: "+(error.code||error.message||"Please try again"));}
}


let activeInboxUnsubscribe=null;
let inboxTimeRefresh=null;
let inboxRenderToken=0;
function formatGramoraInboxTime(timestamp){
  const elapsed=Math.max(0,Date.now()-Number(timestamp||0));
  if(!timestamp||elapsed<60000)return "now";
  const minutes=Math.floor(elapsed/60000);
  if(minutes<60)return minutes+"min";
  const hours=Math.floor(minutes/60);
  if(hours<24)return hours+"hr";
  const days=Math.floor(hours/24);
  return days+"d";
}
function refreshGramoraInboxTimes(){
  document.querySelectorAll(".gramora-inbox-time[data-timestamp]").forEach(node=>{
    node.textContent=formatGramoraInboxTime(Number(node.dataset.timestamp));
  });
}
function clearGramoraInboxUnread(conversationId,lastMessage){
  const list=document.querySelector(".gramora-inbox .gramora-conversation-list");
  if(!list)return;
  const row=[...list.querySelectorAll(".gramora-conversation")].find(item=>item.dataset.conversationId===conversationId);
  if(!row)return;
  row.classList.remove("has-unread");
  row.querySelector(".gramora-inbox-unread")?.remove();
  const preview=row.querySelector(".gramora-conversation-details small");
  if(preview)preview.textContent=lastMessage||"Start a conversation";
}

function stopGramoraInbox(){
  if(activeInboxUnsubscribe){activeInboxUnsubscribe();activeInboxUnsubscribe=null;}
  if(inboxTimeRefresh){clearInterval(inboxTimeRefresh);inboxTimeRefresh=null;}
  inboxRenderToken++;
}
async function renderGramoraInbox(user){
  stopGramoraInbox();
  const token=inboxRenderToken;
  inboxTimeRefresh=setInterval(refreshGramoraInboxTimes,15000);
  const page=document.querySelector(".gramora-inbox");
  if(!page||!user||!db)return;
  const empty=page.querySelector(".gramora-inbox-empty");
  const emptyTitle=empty?.querySelector("h3");
  const emptyText=empty?.querySelector("p");
  if(emptyTitle)emptyTitle.textContent="Loading chats…";
  if(emptyText)emptyText.textContent="Your conversations will appear here.";
  activeInboxUnsubscribe=onSnapshot(
    query(collection(db,"conversations"),where("participantUids","array-contains",user.uid)),
    async snapshot=>{
      if(token!==inboxRenderToken||auth?.currentUser?.uid!==user.uid)return;
      const list=page.querySelector(".gramora-conversation-list");
      if(!list)return;
      const rows=await Promise.all(snapshot.docs.map(async conversationDoc=>{
        const data=conversationDoc.data();
        const otherUid=(data.participantUids||[]).find(uid=>uid!==user.uid);
        if(!otherUid)return null;
        let profile={};
        try{const profileSnap=await getDoc(doc(db,"userProfiles",otherUid));if(profileSnap.exists())profile=profileSnap.data();}
        catch(error){console.warn("Chat profile unavailable",error);}
        const clearedAt=Number(localStorage.getItem("gramora-chat-cleared:"+user.uid+":"+conversationDoc.id)||0);
        let unreadCount=0;
        try{
          const recentMessages=await getDocs(query(collection(db,"conversations",conversationDoc.id,"messages"),orderBy("createdAt","desc"),limit(50)));
          unreadCount=recentMessages.docs.filter(messageDoc=>{
            const message=messageDoc.data();
            return (message.createdAt?.toMillis?.()||0)>clearedAt&&message.senderUid===otherUid&&message.status!=="seen";
          }).length;
        }catch(error){console.warn("Unread message count unavailable",error);}
        const lastMessageAt=data.lastMessageAt?.toMillis?.()||0;
        const visibleLastMessage=lastMessageAt>clearedAt?(data.lastMessage||""):"";
        return {id:conversationDoc.id,uid:otherUid,profile,
          displayName:profile.displayName||profile.username||"GRAMORA member",
          username:profile.username||"member",photoURL:profile.photoURL||"",
          lastMessage:visibleLastMessage,lastMessageAt,unreadCount};
      }));
      if(token!==inboxRenderToken||auth?.currentUser?.uid!==user.uid)return;
      const sorted=rows.filter(Boolean).sort((a,b)=>b.lastMessageAt-a.lastMessageAt);
      list.replaceChildren();
      sorted.forEach(item=>{
        const row=document.createElement("button");row.type="button";row.className="gramora-conversation";row.dataset.conversationId=item.id;
        const avatar=document.createElement("span");avatar.className="gramora-conversation-avatar";
        if(item.photoURL){const img=document.createElement("img");img.src=item.photoURL;img.alt="";avatar.append(img);}
        else avatar.textContent=item.displayName.charAt(0).toUpperCase();
        const details=document.createElement("span");details.className="gramora-conversation-details";
        const name=document.createElement("strong");name.textContent=item.displayName;
        const preview=document.createElement("small");preview.textContent=item.unreadCount>1?(item.unreadCount>3?"4+ new messages":item.unreadCount+" new messages"):(item.lastMessage||"Start a conversation");
        if(item.unreadCount)row.classList.add("has-unread");
        details.append(name,preview);
        const right=document.createElement("span");right.className="gramora-conversation-right";
        const time=document.createElement("small");time.className="gramora-inbox-time";
        time.dataset.timestamp=String(item.lastMessageAt||0);
        time.textContent=formatGramoraInboxTime(item.lastMessageAt);
        time.setAttribute("aria-label",item.lastMessageAt?new Date(item.lastMessageAt).toLocaleString():"No recent message");
        right.append(time);
        const arrow=document.createElement("span");arrow.className="gramora-conversation-arrow";arrow.textContent="›";right.append(arrow);
        row.append(avatar,details,right);
        row.addEventListener("click",()=>openGramoraChat(user,item.uid,item.profile));
        list.append(row);
      });
      const search=page.querySelector(".gramora-inbox-search input");
      const term=search?.value.trim().toLowerCase()||"";
      let visible=0;
      list.querySelectorAll(".gramora-conversation").forEach(row=>{
        const match=row.textContent.toLowerCase().includes(term);row.hidden=!match;if(match)visible++;
      });
      if(empty){
        empty.hidden=visible>0;
        if(emptyTitle)emptyTitle.textContent=sorted.length?(term?"No conversations found":"No conversations to show"):"Your messages will appear here";
        if(emptyText)emptyText.textContent=sorted.length?"Try another name or username.":"When you message someone, your conversation will appear here.";
      }
    },
    error=>{
      console.error("GRAMORA inbox listener:",error);
      if(token!==inboxRenderToken)return;
      if(empty){empty.hidden=false;if(emptyTitle)emptyTitle.textContent="Couldn't load chats";if(emptyText)emptyText.textContent="Check internet connection and Firestore Rules.";}
    }
  );
}
document.addEventListener("gramora:view",event=>{
  if(event.detail==="messages"){
    const user=auth?.currentUser;
    if(user)renderGramoraInbox(user);
  }else stopGramoraInbox();
});

function exitPublicProfilePage(){
  document.body.classList.remove("public-profile-open");
  document.querySelector('.mobile-nav [data-view="home"], .sidebar [data-view="home"]')?.click();
}
function formatPostViews(value){const count=Math.max(0,Number(value)||0);if(count>=1000000){const n=count/1000000;return (n>=10?n.toFixed(0):n.toFixed(1)).replace(/\.0$/,'')+'M';}if(count>=1000){const n=count/1000;return (n>=100?n.toFixed(0):n.toFixed(1)).replace(/\.0$/,'')+'K';}return Math.floor(count).toLocaleString('en-US');}
async function recordPostView(post){const viewer=auth?.currentUser;if(!viewer||!post?.id||!post?.uid)return null;const postRef=doc(db,'posts',post.id),viewRef=doc(db,'postViews',post.id+'_'+viewer.uid);return runTransaction(db,async transaction=>{const postSnap=await transaction.get(postRef),viewSnap=await transaction.get(viewRef);if(!postSnap.exists())return null;const current=Math.max(0,Number(postSnap.data().views)||0);if(viewSnap.exists())return current;transaction.update(postRef,{views:increment(1)});transaction.set(viewRef,{postId:post.id,postUid:post.uid,uid:viewer.uid,createdAt:serverTimestamp()});return current+1;});}
let publicProfileLoadToken=0;
async function loadPublicProfile(viewer,targetUid){
  const profileLoadToken=++publicProfileLoadToken;
  document.body.classList.add("public-profile-open");
  document.querySelectorAll(".nav").forEach(item=>item.classList.remove("active"));
  const title=document.getElementById("viewTitle");if(title)title.textContent="Profile";
  const feed=document.getElementById("feed");
  if(targetUid===viewer.uid){loadProfilePage(viewer);return;}
  feed.innerHTML='<div class="profile-loading">Loading profile…</div>';
  try{
    const blockStatus=await getBlockStatus(viewer.uid,targetUid);
    if(profileLoadToken!==publicProfileLoadToken||!document.body.classList.contains("public-profile-open"))return;
    if(blockStatus.blockedMe){feed.textContent="This profile isn't available.";return;}
    if(blockStatus.blockedByMe){
      const blockedPanel=document.createElement("section");blockedPanel.className="ig-profile";
      blockedPanel.innerHTML='<div class="ig-no-posts"><strong>⊘</strong><b>You blocked this account</b><span>You will not be able to follow or message this account while it is blocked.</span></div><div class="ig-profile-actions"><button type="button" class="public-unblock">Unblock</button></div>';
      feed.replaceChildren(blockedPanel);
      blockedPanel.querySelector(".public-unblock").addEventListener("click",async()=>{
        const button=blockedPanel.querySelector(".public-unblock");button.disabled=true;button.textContent="Unblocking…";
        try{await deleteDoc(doc(db,"userBlocks",viewer.uid+"_"+targetUid));await loadPublicProfile(viewer,targetUid);}
        catch(error){console.error("Unblock failed:",error);button.disabled=false;button.textContent="Unblock";alert("Unblock nahi ho paya. Latest Firestore Rules publish karein.");}
      });
      return;
    }
    const snap=await getDoc(doc(db,"userProfiles",targetUid));
    if(profileLoadToken!==publicProfileLoadToken||!document.body.classList.contains("public-profile-open"))return;
    if(!snap.exists()){feed.textContent="Profile unavailable.";return;}
    const p=snap.data();
    p.username=await getUsernameForUid(targetUid,p);
    let posts=[],postsCount=0,followersCount=0,followingCount=0,already=false,requestPending=false;
    const canViewProfilePosts=!p.isPrivate||(await getDoc(doc(db,"follows",viewer.uid+"_"+targetUid))).exists();
    const repostsPromise=(async()=>{
      if(!canViewProfilePosts)return {docs:[]};
      const candidateUids=await getVisibleContentUids(viewer);
      const blockChecks=await Promise.all(candidateUids.map(uid=>getBlockStatus(viewer.uid,uid)));
      const visibleOriginalUids=candidateUids.filter((uid,index)=>!blockChecks[index].blockedByMe&&!blockChecks[index].blockedMe);
      const batches=[];
      for(let i=0;i<visibleOriginalUids.length;i+=30)batches.push(visibleOriginalUids.slice(i,i+30));
      const snapshots=await Promise.all(batches.map(batch=>getDocs(query(
        collection(db,"repostFeed"),
        where("uid","==",targetUid),
        where("originalUid","in",batch),
        limit(60)
      ))));
      return {docs:snapshots.flatMap(snapshot=>snapshot.docs)};
    })();
    const results=await Promise.allSettled([
      canViewProfilePosts?getDocs(query(collection(db,"posts"),where("uid","==",targetUid),limit(60))):Promise.resolve({docs:[]}),
      repostsPromise,
      getDocs(query(collection(db,"follows"),where("followingUid","==",targetUid),limit(100))),
      getDocs(query(collection(db,"follows"),where("followerUid","==",targetUid),limit(100))),
      getDoc(doc(db,"follows",viewer.uid+"_"+targetUid)),
      getDoc(doc(db,"followRequests",viewer.uid+"_"+targetUid)),
      canViewProfilePosts?getCountFromServer(query(collection(db,"posts"),where("uid","==",targetUid))):Promise.resolve({data:()=>({count:0})})
    ]);
    if(profileLoadToken!==publicProfileLoadToken||!document.body.classList.contains("public-profile-open"))return;
    if(results[0].status==="fulfilled")posts=results[0].value.docs;
    if(results[2].status==="fulfilled")followersCount=results[2].value.size;
    if(results[3].status==="fulfilled")followingCount=results[3].value.size;
    if(results[4].status==="fulfilled")already=results[4].value.exists();
    if(results[5].status==="fulfilled")requestPending=results[5].value.exists();
    if(results[6].status==="fulfilled")postsCount=results[6].value.data().count;
    const panel=document.createElement("section");panel.className="ig-profile";
    const avatar=p.photoURL?'<img alt="" src="'+escapeHtml(p.photoURL)+'">':escapeHtml((p.displayName||"G").charAt(0).toUpperCase());
    panel.innerHTML='<header class="public-profile-page-head"><button class="public-profile-back" type="button" aria-label="Back">‹</button><strong>@'+escapeHtml(p.username||"member")+'</strong><button class="public-profile-more public-block" type="button" aria-label="More options">⋯</button></header><div class="ig-profile-top"><div class="ig-avatar-wrap"><div class="ig-profile-avatar">'+avatar+'</div></div><div class="ig-profile-summary"><div class="ig-profile-username"><strong>'+escapeHtml(p.displayName||"GRAMORA member")+'</strong></div><div class="ig-profile-stats"><span class="profile-stat"><b>'+((p.isPrivate&&!already)?"—":postsCount)+'</b><small>posts</small></span><button class="stat-open profile-stat" data-list="followers" type="button"><b>'+followersCount+'</b><small>followers</small></button><button class="stat-open profile-stat" data-list="following" type="button"><b>'+followingCount+'</b><small>following</small></button></div></div></div><div class="ig-profile-bio"><p>'+escapeHtml(p.bio||"")+'</p></div><div class="ig-profile-actions"><button class="public-follow'+(already?' is-following':(requestPending?' is-requested':''))+'" type="button">'+(already?"Following":(requestPending?"Requested":"Follow"))+'</button><button class="public-message" type="button" aria-label="Message '+escapeHtml(p.displayName||"user")+'">Message</button><button class="public-add-person" type="button" aria-label="Add person"></button></div><div class="ig-highlights public-profile-highlights" aria-label="Story highlights" hidden></div><div class="ig-profile-tabs public-profile-tabs" role="tablist"><button class="active" data-public-profile-tab="posts" type="button" aria-label="Posts" title="Posts"></button><button data-public-profile-tab="reposts" type="button" aria-label="Reposts" title="Reposts"></button></div><div class="ig-profile-grid"></div>';
    feed.replaceChildren(panel);
    panel.querySelector(".public-profile-back").addEventListener("click",exitPublicProfilePage);
    if(title)title.textContent="@"+(p.username||"member");
    if(!p.isPrivate||already)loadProfileHighlights({uid:targetUid},panel,false);
    bindAvatarLongPress(panel.querySelector(".ig-profile-avatar"),targetUid,p);
    panel.querySelectorAll(".stat-open").forEach(btn=>btn.addEventListener("click",()=>showFollowList(targetUid,btn.dataset.list)));
    panel.querySelector(".public-message").addEventListener("click",()=>{
      openGramoraChat(viewer,targetUid,p);
    });
    panel.querySelector(".public-block").addEventListener("click",event=>{
      event.stopPropagation();
      const existingMenu=panel.querySelector(".public-profile-menu");
      if(existingMenu){existingMenu.remove();return;}
      const menu=document.createElement("div");menu.className="public-profile-menu";
      const blockOption=document.createElement("button");blockOption.type="button";blockOption.textContent="Block account";
      blockOption.addEventListener("click",async()=>{
        menu.remove();
        if(!confirm("Block @"+(p.username||"this account")+"? They won't be able to message or follow you."))return;
        const button=panel.querySelector(".public-block");button.disabled=true;
        try{
          await setDoc(doc(db,"userBlocks",viewer.uid+"_"+targetUid),{
            blockerUid:viewer.uid,blockedUid:targetUid,
            blockedName:p.displayName||"GRAMORA member",
            blockedUsername:p.username||"",createdAt:serverTimestamp()
          });
          await deleteDoc(doc(db,"follows",viewer.uid+"_"+targetUid)).catch(()=>{});
          await loadPublicProfile(viewer,targetUid);
        }catch(error){console.error("Block account failed:",error);button.disabled=false;alert(error.code==="permission-denied"?"Block option ke liye latest Firestore Rules publish karein.":"Account block nahi hua. Dobara try karein.");}
      });
      menu.append(blockOption);panel.querySelector(".public-profile-page-head").append(menu);
      document.addEventListener("click",()=>menu.remove(),{once:true});
    });
    panel.querySelector(".public-follow").addEventListener("click",async e=>{
      const btn=e.currentTarget;
      try{
        const blockStatus=await getBlockStatus(viewer.uid,targetUid);
        if(blockStatus.blockedByMe||blockStatus.blockedMe){alert("Blocked account ke saath follow nahi kar sakte.");return;}

        if((await getDoc(doc(db,"follows",viewer.uid+"_"+targetUid))).exists()){
          btn.disabled=true;
          await deleteDoc(doc(db,"follows",viewer.uid+"_"+targetUid));
          btn.textContent="Follow";
          btn.classList.remove("is-following");
          const followersStat=panel.querySelector('.ig-profile-stats [data-list="followers"] b');
          if(followersStat)followersStat.textContent=String(Math.max(0,(Number(followersStat.textContent)||0)-1));
          if(p.isPrivate){
            const grid=panel.querySelector(".ig-profile-grid");
            grid.replaceChildren();
            const lock=document.createElement("div");lock.className="private-profile-notice";
            lock.innerHTML='<strong>🔒 This account is private</strong><span>Follow this account to see their photos and posts.</span>';
            grid.append(lock);
            panel.querySelector(".public-profile-tabs").hidden=true;
            panel.querySelector(".public-message").disabled=true;
            const highlights=panel.querySelector(".public-profile-highlights");
            if(highlights){highlights.replaceChildren();highlights.hidden=true;}
          }
          btn.disabled=false;
          return;
        }
        if(p.isPrivate){
          const requestRef=doc(db,"followRequests",viewer.uid+"_"+targetUid);
          if((await getDoc(requestRef)).exists()){await deleteDoc(requestRef);btn.textContent="Follow";btn.classList.remove("is-requested");}
          else{
            const viewerSnap=await getDoc(doc(db,"userProfiles",viewer.uid)),viewerProfile=viewerSnap.exists()?viewerSnap.data():{};
            await setDoc(requestRef,{fromUid:viewer.uid,toUid:targetUid,fromName:viewerProfile.displayName||viewer.displayName||"GRAMORA member",fromUsername:viewerProfile.username||"",createdAt:serverTimestamp()});
            btn.textContent="Requested";btn.classList.add("is-requested");await createGramoraNotification(targetUid,"follow_request","sent you a follow request.");
          }
        }else{
          await setDoc(doc(db,"follows",viewer.uid+"_"+targetUid),{followerUid:viewer.uid,followingUid:targetUid,createdAt:serverTimestamp()});btn.textContent="Following";btn.classList.add("is-following");await createGramoraNotification(targetUid,"follow","started following you.");
        }
      }catch(err){console.error("Follow action:",err);alert("Follow action failed. Check that the latest Firestore Rules are published.");}
    });
    panel.querySelector(".public-add-person").addEventListener("click",()=>panel.querySelector(".public-follow")?.click());
    const grid=panel.querySelector(".ig-profile-grid");
    const publicTabs=panel.querySelectorAll("[data-public-profile-tab]");
    function renderPublicProfileItems(items,isRepostTab){
      grid.replaceChildren();
      if(!items.length){
        const empty=document.createElement("div");empty.className="ig-no-posts";
        empty.innerHTML=isRepostTab?'<strong>⟳</strong><b>No reposts yet</b><span>Posts this user reposts will appear here.</span>':'<strong>▧</strong><b>No posts yet</b><span>Posts shared by this user will appear here.</span>';
        grid.append(empty);return;
      }
      items.sort((x,y)=>(y.data().createdAt?.toMillis?.()||y.data().createdAt?.seconds*1000||0)-(x.data().createdAt?.toMillis?.()||x.data().createdAt?.seconds*1000||0)).forEach(d=>{
        const raw=d.data(),isRepost=!!isRepostTab;
        const authorUid=isRepost?raw.originalUid:raw.uid;
        const originalId=isRepost?raw.originalPostId:d.id;
        const post=isRepost?{id:originalId,uid:raw.originalUid,displayName:raw.originalDisplayName,username:raw.originalUsername,photoURL:raw.originalPhotoURL,text:raw.originalText,background:raw.originalBackground,createdAt:raw.originalCreatedAt,views:raw.originalViews??raw.views??0,pinned:raw.originalPinned===true}:{id:d.id,...raw};
        const wrap=document.createElement("div");wrap.className="ig-post-wrap";
        const tile=document.createElement("button");tile.type="button";tile.className="ig-post-tile";tile.dataset.postId=originalId;tile.style.background=post.background||POST_BACKGROUNDS[4];
        const copy=document.createElement("span");copy.className="ig-post-tile-copy";copy.textContent=post.text||"";
        const viewBadge=document.createElement("span");viewBadge.className="ig-post-view-badge";
        const eye=document.createElement("span");eye.className="ig-post-view-eye";
        const viewCount=document.createElement("span");viewCount.className="ig-post-view-count";viewCount.dataset.postId=originalId;viewCount.textContent=formatPostViews(post.views);
        viewBadge.append(eye,viewCount);tile.append(copy,viewBadge);
        if(post.pinned===true||raw.pinned===true||raw.isPinned===true){const pin=document.createElement("span");pin.className="ig-post-pinned";pin.setAttribute("aria-label","Pinned post");tile.append(pin);}
        tile.addEventListener("click",()=>openPostDetail(post,false));wrap.append(tile);grid.append(wrap);
        if(isRepost&&raw.originalViews==null&&raw.views==null){getDoc(doc(db,"posts",originalId)).then(postSnap=>{if(postSnap.exists()&&viewCount.isConnected)viewCount.textContent=formatPostViews(postSnap.data().views||0);}).catch(error=>console.warn("Reposted post view count unavailable:",error));}
      });
    }
    function showPublicProfileTab(tab){
      publicTabs.forEach(button=>button.classList.toggle("active",button.dataset.publicProfileTab===tab));
      if(p.isPrivate&&!already){return;}
      if(tab==="posts"){
        if(results[0].status==="rejected"){
          grid.innerHTML='<div class="ig-no-posts"><strong>!</strong><b>Posts unavailable</b><span>Check Firestore Rules and try again.</span></div>';return;
        }
        renderPublicProfileItems(posts,false);
      }else{
        if(results[1].status==="rejected"){
          grid.innerHTML='<div class="ig-no-posts"><strong>!</strong><b>Reposts unavailable</b><span>Check Firestore Rules and try again.</span></div>';return;
        }
        renderPublicProfileItems(results[1].value.docs,true);
      }
    }
    if(p.isPrivate&&!already){
      const lock=document.createElement("div");lock.className="private-profile-notice";lock.innerHTML='<strong>🔒 This account is private</strong><span>Follow this account to see their photos and posts.</span>';
      grid.append(lock);panel.querySelector(".public-message").disabled=true;
      panel.querySelector(".public-profile-tabs").hidden=true;
    }else{
      publicTabs.forEach(button=>button.addEventListener("click",()=>showPublicProfileTab(button.dataset.publicProfileTab)));
      showPublicProfileTab("posts");
    }
    if(results.slice(2,6).some(x=>x.status==="rejected")){
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
  const user=auth?.currentUser;if(!user)return;
  try{
    const uids=await getVisibleContentUids(user),groups=[];
    for(let i=0;i<uids.length;i+=30)groups.push(uids.slice(i,i+30));
    const postReads=uids.map(uid=>getDocs(query(collection(db,"posts"),where("uid","==",uid),limit(100))));
    const repostReads=groups.flatMap(reposterBatch=>groups.map(originalBatch=>getDocs(query(
      collection(db,"repostFeed"),
      where("uid","in",reposterBatch),
      where("originalUid","in",originalBatch),
      limit(100)
    ))));
    const snapshots=await Promise.all([...postReads,...repostReads]);
    const posts=snapshots.slice(0,postReads.length).flatMap(snap=>snap.docs);
    const reposts=snapshots.slice(postReads.length).flatMap(snap=>snap.docs.map(item=>({id:"repost_"+item.id,data:()=>({...item.data(),_isRepost:true,_repostId:item.id})})));
    const combined=[...posts,...reposts].sort((a,b)=>(b.data().createdAt?.toMillis?.()||0)-(a.data().createdAt?.toMillis?.()||0)).slice(0,60);
    if(activeView==="home")renderPosts(combined);
  }catch(error){console.error(error);showFeedMessage("Could not load posts ("+(error.code||"unknown")+"): "+(error.message||"Check Firestore Rules."));}
}
const POST_BACKGROUNDS=["linear-gradient(135deg,#ff9966,#ff5e62)","linear-gradient(135deg,#7f7fd5,#86a8e7,#91eae4)","linear-gradient(135deg,#654ea3,#eaafc8)","linear-gradient(135deg,#11998e,#38ef7d)","linear-gradient(135deg,#232526,#414345)","linear-gradient(135deg,#f7971e,#ffd200)","linear-gradient(135deg,#fc466b,#3f5efb)","linear-gradient(135deg,#eeaeca,#94bbe9)"];
let editingPostId=null,currentViewedPost=null,storyEditingId=null;
function bindBackgroundPicker(selector,inputId,previewId){
  const picker=document.querySelector(selector),input=document.getElementById(inputId),preview=document.getElementById(previewId);
  if(!picker||!input)return;
  picker.querySelectorAll("[data-bg]").forEach(button=>button.addEventListener("click",()=>{
    input.value=button.dataset.bg;picker.querySelectorAll("[data-bg]").forEach(item=>item.classList.toggle("selected",item===button));
    if(preview){preview.style.background=button.dataset.bg;preview.style.color="#fff";}
  }));
  const first=picker.querySelector("[data-bg]");if(first){input.value=first.dataset.bg;first.classList.add("selected");if(preview){preview.style.background=first.dataset.bg;preview.style.color="#fff";}}
}
bindBackgroundPicker("#postBackgroundPicker","postBackground","caption");
bindBackgroundPicker("#storyBackgroundPicker","storyBackground","storyPreviewCanvas");
function openPostEditor(post){
  editingPostId=post?.id||null;const bg=post?.background||POST_BACKGROUNDS[4];
  document.getElementById("caption").value=post?.text||"";document.getElementById("postBackground").value=bg;document.getElementById("caption").style.background=bg;
  document.querySelectorAll("#postBackgroundPicker [data-bg]").forEach(b=>b.classList.toggle("selected",b.dataset.bg===bg));
  document.querySelector("#createDialog h2").textContent=editingPostId?"Edit post":"Create a post";
  document.querySelector("#postForm .publish").textContent=editingPostId?"Save changes":"Share with the community ↗";
  document.getElementById("postStatus").textContent="";document.getElementById("createDialog").showModal();
}
function openPostDetail(post,canEdit=false){
  currentViewedPost=post;const card=document.getElementById("postDetailCard");card.textContent=post.text||"";card.style.background=post.background||POST_BACKGROUNDS[4];
  document.getElementById("postDetailByline").textContent=(post.displayName||"GRAMORA member")+(post.username?" · @"+post.username:"")+" · "+formatPostDate(post.createdAt);
  document.getElementById("postDetailEdit").hidden=!canEdit;document.getElementById("postDetailDelete").hidden=!canEdit;
  const dialog=document.getElementById("postDetailDialog");dialog.dataset.postId=post.id;dialog.showModal();loadPostEngagement(post,dialog);
  recordPostView(post).then(count=>{if(count===null)return;document.querySelectorAll(".ig-post-view-count").forEach(node=>{if(node.dataset.postId===post.id)node.textContent=formatPostViews(count);});}).catch(error=>console.warn("Post view count update failed:",error));
}
document.getElementById("postDetailEdit")?.addEventListener("click",()=>{if(!currentViewedPost)return;document.getElementById("postDetailDialog").close();openPostEditor(currentViewedPost);});
document.getElementById("postDetailDelete")?.addEventListener("click",async()=>{
  if(!currentViewedPost)return;const post=currentViewedPost,button=document.getElementById("postDetailDelete");button.disabled=true;
  try{await deleteDoc(doc(db,"posts",post.id));document.getElementById("postDetailDialog").close();if(activeView==="profile")await loadProfilePage(auth.currentUser);else await getDocsForFeed();}
  catch(error){console.error(error);alert("Post delete nahi hui. Firestore Rules check karein.");}finally{button.disabled=false;}
});
document.getElementById("postDetailLike")?.addEventListener("click",()=>{if(currentViewedPost)togglePostLike(currentViewedPost.id,currentViewedPost.uid,document.getElementById("postDetailLike"),document.querySelector("#postDetailLike .post-action-count")).then(()=>loadPostEngagement(currentViewedPost,document.getElementById("postDetailDialog")));});
document.getElementById("postCommentForm")?.addEventListener("submit",async event=>{
  event.preventDefault();const post=currentViewedPost,user=auth?.currentUser,input=document.getElementById("postCommentInput"),status=document.getElementById("postCommentStatus"),button=event.currentTarget.querySelector("button[type=submit]"),text=input.value.trim();
  if(!post||!user||!text)return;button.disabled=true;status.textContent="Comment post ho raha hai…";
  try{const profileSnap=await getDoc(doc(db,"userProfiles",user.uid)),profile=profileSnap.exists()?profileSnap.data():{};await addDoc(collection(db,"postComments"),{postId:post.id,postUid:post.uid,uid:user.uid,displayName:profile.displayName||user.displayName||"GRAMORA member",text,createdAt:serverTimestamp()});await refreshVisiblePostCommentCount(post);await createGramoraNotification(post.uid,"post_comment","commented on your post: "+text.slice(0,90),{postId:post.id});input.value="";await loadPostEngagement(post,document.getElementById("postDetailDialog"));}
  catch(error){console.error("Post comment failed:",error);status.textContent=error.code==="permission-denied"?"Latest Firestore Rules publish karein.":"Comment post nahi hua. Dobara try karein.";}finally{button.disabled=false;}
});
document.getElementById("closePostDetail")?.addEventListener("click",()=>document.getElementById("postDetailDialog").close());
const postForm=document.getElementById("postForm");
postForm.addEventListener("submit",async event=>{
  event.preventDefault();
  const dialog=document.getElementById("createDialog");
  const status=document.getElementById("postStatus");
  
  if(!auth?.currentUser){status.textContent="Please log in to publish a post.";return;}
  const text=document.getElementById("caption").value.trim();
  const background=document.getElementById("postBackground").value||POST_BACKGROUNDS[4];
  if(!text){status.textContent="Write something before sharing.";return;}
  const button=postForm.querySelector(".publish");
  button.disabled=true;button.textContent=editingPostId?"Saving…":"Sharing…";status.textContent=editingPostId?"Post update ho rahi hai…":"Publishing your post…";
  try{
    const user=auth.currentUser;
    const profileSnap=await getDoc(doc(db,"userProfiles",user.uid));
    const profile=profileSnap.exists()?profileSnap.data():{};
    if(editingPostId){
      await updateDoc(doc(db,"posts",editingPostId),{text,background});editingPostId=null;status.textContent="Post updated successfully!";dialog.close();
      if(activeView==="profile")await loadProfilePage(user);else await getDocsForFeed();
    }else{
      await addDoc(collection(db,"posts"),{uid:user.uid,displayName:profile.displayName||user.displayName||"GRAMORA member",username:profile.username||"",text,background,createdAt:serverTimestamp()});
      document.getElementById("caption").value="";status.textContent="Posted successfully!";dialog.close();activeView="home";
      document.querySelector('.mobile-nav [data-view="home"], .sidebar [data-view="home"]')?.click();
    }
  }catch(error){
    console.error("Post publish failed:",error);
    status.textContent=error.code==="permission-denied"?"Firestore denied this post. Open Firebase Console → Firestore → Rules and publish the latest firestore.rules from GitHub.":"Post failed: "+(error.message||"Check your internet and try again.");
  }finally{button.disabled=false;button.textContent=editingPostId?"Save changes":"Share with the community ↗";}
});
function renderProfile(user){
  // Navigation is handled once by script.js; do not attach a second profile click handler.
}

let highlightArchiveDocs=[],highlightSelectedIds=new Set(),highlightEditingId=null,highlightCoverImage="",highlightCoverStoryId="";
async function getHighlightArchive(user){
  const snap=await getDocs(query(collection(db,"stories"),where("uid","==",user.uid),limit(100)));
  const docs=snap.docs.map(d=>({id:d.id,data:()=>d.data()}));
  docs.sort((x,y)=>(y.data().createdAt?.toMillis?.()||0)-(x.data().createdAt?.toMillis?.()||0));
  return docs;
}
function highlightStoryCard(item,selected){
  const data=item.data(),button=document.createElement("button");button.type="button";
  button.className="highlight-story-tile"+(selected?" selected":"");
  button.style.background=data.background||POST_BACKGROUNDS[4];
  const text=document.createElement("span");text.className="highlight-story-tile-text";text.textContent=(data.text||data.songTitle||"Story").slice(0,70);
  const mark=document.createElement("i");mark.className="highlight-story-select-mark";mark.textContent=selected?"✓":"";
  const date=document.createElement("small");date.textContent=data.createdAt?.toDate?.().toLocaleDateString?.()||"Story";
  button.append(text,mark,date);button.addEventListener("click",()=>{
    if(highlightSelectedIds.has(item.id))highlightSelectedIds.delete(item.id);else if(highlightSelectedIds.size<20)highlightSelectedIds.add(item.id);
    renderHighlightArchive();
  });return button;
}
function renderHighlightArchive(){
  const grid=document.getElementById("highlightStoryChoices"),count=document.getElementById("highlightSelectedCount");
  if(!grid)return;grid.replaceChildren();
  const selected=highlightArchiveDocs.filter(item=>highlightSelectedIds.has(item.id));
  if(count)count.textContent=selected.length+" selected";
  if(!highlightArchiveDocs.length){grid.textContent="No stories are available in your archive yet.";return;}
  highlightArchiveDocs.forEach(item=>grid.append(highlightStoryCard(item,highlightSelectedIds.has(item.id))));
}
function renderHighlightCoverChoices(){
  const grid=document.getElementById("highlightCoverChoices");if(!grid)return;grid.replaceChildren();
  const selected=highlightArchiveDocs.filter(item=>highlightSelectedIds.has(item.id));
  selected.forEach(item=>{
    const data=item.data(),button=document.createElement("button");button.type="button";button.className="highlight-cover-choice"+(highlightCoverStoryId===item.id?" selected":"");button.style.background=data.background||POST_BACKGROUNDS[4];
    const label=document.createElement("span");label.textContent=(data.text||data.songTitle||"Story").slice(0,45);button.append(label);
    button.addEventListener("click",()=>{highlightCoverStoryId=item.id;highlightCoverImage="";renderHighlightCoverChoices();updateHighlightCoverPreview();});grid.append(button);
  });
}
function updateHighlightCoverPreview(){
  const preview=document.getElementById("highlightCoverPreview");if(!preview)return;
  preview.replaceChildren();
  if(highlightCoverImage){const img=document.createElement("img");img.src=highlightCoverImage;img.alt="Highlight cover";preview.append(img);return;}
  const item=highlightArchiveDocs.find(x=>x.id===highlightCoverStoryId)||highlightArchiveDocs.find(x=>highlightSelectedIds.has(x.id));
  if(item){const d=item.data();preview.textContent=(d.text||d.songTitle||"G").slice(0,2).toUpperCase();preview.style.background=d.background||POST_BACKGROUNDS[4];}
  else preview.textContent="G";
}
async function compressHighlightCover(file){
  if(!file||!file.type.startsWith("image/"))throw new Error("Choose an image file.");
  const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
  const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=dataUrl;});
  const canvas=document.createElement("canvas");canvas.width=400;canvas.height=400;
  const side=Math.min(img.width,img.height);canvas.getContext("2d").drawImage(img,(img.width-side)/2,(img.height-side)/2,side,side,0,0,400,400);
  const result=canvas.toDataURL("image/jpeg",0.72);if(result.length>420000)throw new Error("Cover image is too large. Choose another image.");return result;
}
async function openHighlightCreator(user,initialStoryId="",editingDoc=null){
  const dialog=document.getElementById("highlightCreateDialog"),form=document.getElementById("highlightCreateForm"),status=document.getElementById("highlightCreateStatus");
  if(!dialog||!form)return;
  highlightEditingId=editingDoc?.id||null;highlightSelectedIds=new Set((editingDoc?.data()?.stories||[]).map(x=>x.storyId).filter(Boolean));highlightCoverImage=editingDoc?.data()?.coverImage||"";highlightCoverStoryId=editingDoc?.data()?.coverStoryId||"";
  try{
    highlightArchiveDocs=await getHighlightArchive(user);
    (editingDoc?.data()?.stories||[]).forEach((story,index)=>{if(story.storyId&&!highlightArchiveDocs.some(x=>x.id===story.storyId))highlightArchiveDocs.push({id:story.storyId,data:()=>story});});
    if(initialStoryId)highlightSelectedIds.add(initialStoryId);
    const titleInput=form.elements.title;titleInput.value=editingDoc?.data()?.title||"";
    document.getElementById("highlightWizardTitle").textContent=editingDoc?"Edit highlight":"New highlight";
    document.getElementById("highlightStoryStep").hidden=false;document.getElementById("highlightDetailsStep").hidden=true;
    document.getElementById("highlightBackBtn").hidden=true;document.getElementById("highlightNextBtn").hidden=false;document.getElementById("highlightSaveBtn").hidden=true;
    status.textContent="";renderHighlightArchive();renderHighlightCoverChoices();updateHighlightCoverPreview();
    dialog.showModal();
  }catch(error){console.error("Highlight archive load failed:",error);status.textContent="Stories archive load nahi hua. Internet aur Firestore Rules check karein.";dialog.showModal();}
}

async function openStoryHighlightChooser(user,storyId){
  try{
    const snap=await getDocs(query(collection(db,"storyHighlights"),where("uid","==",user.uid)));
    const existing=snap.docs;
    if(!existing.length){openHighlightCreator(user,storyId);return;}
    const dialog=document.createElement("dialog");dialog.className="dp-action-dialog highlight-options-dialog";
    const heading=document.createElement("h3");heading.textContent="Add to highlight";dialog.append(heading);
    existing.forEach(highlightDoc=>{
      const data=highlightDoc.data(),button=document.createElement("button");button.type="button";button.textContent=(data.title||"Highlight")+"  ›";
      button.addEventListener("click",async()=>{
        button.disabled=true;
        try{
          const raw=activeStoryDocs.find(item=>item.id===storyId)?.data();
          if(!raw)throw new Error("Story is no longer available.");
          const stories=[...(data.stories||[])];
          if(stories.some(item=>item.storyId===storyId)){dialog.close();return;}
          if(stories.length>=20)throw new Error("This highlight already has 20 stories.");
          stories.push({storyId,uid:raw.uid,displayName:raw.displayName||user.displayName||"GRAMORA member",text:raw.text||"",lyrics:raw.lyrics||"",background:raw.background||POST_BACKGROUNDS[4],songTitle:raw.songTitle||"",songArtist:raw.songArtist||"",songUrl:raw.songUrl||"",previewUrl:raw.previewUrl||"",songArtwork:raw.songArtwork||"",songStart:Number(raw.songStart||0),createdAt:raw.createdAt||null});
          await updateDoc(doc(db,"storyHighlights",highlightDoc.id),{stories,coverStoryId:data.coverStoryId||stories[0]?.storyId||storyId,coverImage:data.coverImage||"",coverText:data.coverText||((stories[0]?.text||data.title||"G").slice(0,2))});
          dialog.close();await loadProfilePage(user);
        }catch(error){console.error("Add story to highlight failed:",error);alert(error.message||"Story highlight update nahi hua.");button.disabled=false;}
      });
      dialog.append(button);
    });
    const create=document.createElement("button");create.type="button";create.textContent="＋  New highlight";create.addEventListener("click",()=>{dialog.close();openHighlightCreator(user,storyId);});dialog.append(create);
    const cancel=document.createElement("button");cancel.type="button";cancel.className="dp-action-cancel";cancel.textContent="Cancel";cancel.addEventListener("click",()=>dialog.close());dialog.append(cancel);
    document.body.append(dialog);dialog.addEventListener("close",()=>dialog.remove(),{once:true});dialog.showModal();
  }catch(error){console.error("Highlight chooser failed:",error);openHighlightCreator(user,storyId);}
}
async function loadProfileHighlights(user,panel,canManage=true){
  const strip=panel.querySelector(".ig-highlights");if(!strip)return;
  try{
    const snap=await getDocs(query(collection(db,"storyHighlights"),where("uid","==",user.uid)));
    if(snap.empty){
      if(!canManage){strip.replaceChildren();strip.hidden=true;}
      return;
    }
    if(!canManage)strip.hidden=false;
    snap.docs.sort((a,b)=>(b.data().createdAt?.toMillis?.()||0)-(a.data().createdAt?.toMillis?.()||0)).forEach(highlightDoc=>{
      const data=highlightDoc.data(),button=document.createElement("button");button.type="button";button.className="ig-highlight saved-highlight";
      const cover=document.createElement("span");if(data.coverImage){const img=document.createElement("img");img.src=data.coverImage;img.alt="";cover.append(img);}else{const item=(data.stories||[]).find(x=>x.storyId===data.coverStoryId)||(data.stories||[])[0];cover.textContent=(item?.text||data.coverText||data.title||"G").slice(0,2).toUpperCase();cover.style.background=item?.background||"";}
      const label=document.createElement("small");label.textContent=data.title||"Highlight";button.append(cover,label);
      const open=()=>{const stories=(data.stories||[]).map((item,index)=>({id:item.storyId||highlightDoc.id+"_"+index,data:()=>item}));if(!stories.length)return;const viewer=document.getElementById("storyViewerDialog");viewer._highlightStories=stories;viewer.dataset.highlightIndex="0";openStoryViewer(stories,stories[0].id);};
      button.addEventListener("click",open);
      if(canManage){
        let holdTimer=null,held=false;
        button.addEventListener("pointerdown",()=>{held=false;holdTimer=setTimeout(()=>{held=true;showHighlightOptions(highlightDoc);},550);});
        ["pointerup","pointerleave","pointercancel"].forEach(type=>button.addEventListener(type,()=>clearTimeout(holdTimer)));
        button.addEventListener("contextmenu",event=>{event.preventDefault();showHighlightOptions(highlightDoc);});
        button.addEventListener("click",event=>{if(held){event.preventDefault();event.stopImmediatePropagation();held=false;}},true);
      }
      strip.append(button);
    });
  }catch(error){
    console.error("Highlights load failed:",error);
    if(!canManage){strip.replaceChildren();strip.hidden=true;return;}
    const note=document.createElement("small");note.className="highlight-load-note";
    note.textContent="Highlights load nahi hui ("+(error.code||"error")+").";
    strip.append(note);
  }
}
function showHighlightOptions(highlightDoc){
  const menu=document.createElement("dialog");menu.className="dp-action-dialog highlight-options-dialog";
  const title=document.createElement("h3");title.textContent=highlightDoc.data().title||"Highlight";
  const edit=document.createElement("button");edit.type="button";edit.textContent="✎  Edit highlight";edit.addEventListener("click",()=>{menu.close();openHighlightCreator(auth.currentUser,"",highlightDoc);});
  const remove=document.createElement("button");remove.type="button";remove.textContent="Delete highlight";remove.addEventListener("click",async()=>{if(!confirm("Delete this highlight?"))return;remove.disabled=true;try{await deleteDoc(doc(db,"storyHighlights",highlightDoc.id));menu.close();await loadProfilePage(auth.currentUser);}catch(error){alert("Highlight delete nahi hua. Dobara try karein.");remove.disabled=false;}});
  const cancel=document.createElement("button");cancel.type="button";cancel.className="dp-action-cancel";cancel.textContent="Cancel";cancel.addEventListener("click",()=>menu.close());
  menu.append(title,edit,remove,cancel);document.body.append(menu);menu.addEventListener("close",()=>menu.remove(),{once:true});menu.showModal();
}
const highlightForm=document.getElementById("highlightCreateForm");
highlightForm?.addEventListener("submit",async event=>{
  event.preventDefault();const user=auth?.currentUser;if(!user)return;
  const title=highlightForm.elements.title.value.trim(),status=document.getElementById("highlightCreateStatus"),button=document.getElementById("highlightSaveBtn");
  const selected=highlightArchiveDocs.filter(item=>highlightSelectedIds.has(item.id));
  if(!title||title.length>24){status.textContent="Highlight name 1–24 characters ka rakhein.";return;}
  if(!selected.length||selected.length>20){status.textContent="1 se 20 stories select karein.";return;}
  const stories=selected.map(item=>{const d=item.data();return {storyId:item.id,uid:d.uid||user.uid,displayName:d.displayName||user.displayName||"GRAMORA member",text:d.text||"",lyrics:d.lyrics||"",background:d.background||POST_BACKGROUNDS[4],songTitle:d.songTitle||"",songArtist:d.songArtist||"",songUrl:d.songUrl||"",previewUrl:d.previewUrl||"",songArtwork:d.songArtwork||"",songStart:Number(d.songStart||0),createdAt:d.createdAt||null};});
  const coverStoryId=highlightCoverStoryId&&highlightSelectedIds.has(highlightCoverStoryId)?highlightCoverStoryId:selected[0].id;
  const payload={title,coverText:(selected.find(x=>x.id===coverStoryId)?.data().text||title).slice(0,2),coverStoryId,coverImage:highlightCoverImage,stories};
  button.disabled=true;status.textContent="Saving highlight…";
  try{
    if(highlightEditingId)await updateDoc(doc(db,"storyHighlights",highlightEditingId),payload);
    else await addDoc(collection(db,"storyHighlights"),{uid:user.uid,...payload,createdAt:serverTimestamp()});
    dialogCloseHighlight();await loadProfilePage(user);
  }catch(error){console.error("Highlight save failed:",error);status.textContent=error.code==="permission-denied"?"Firestore Rules update karne honge.":"Highlight save nahi hua. Dobara try karein.";}
  finally{button.disabled=false;}
});
function dialogCloseHighlight(){document.getElementById("highlightCreateDialog")?.close();highlightEditingId=null;}
document.getElementById("highlightNextBtn")?.addEventListener("click",()=>{
  if(!highlightSelectedIds.size){document.getElementById("highlightCreateStatus").textContent="Select at least one story.";return;}
  document.getElementById("highlightStoryStep").hidden=true;document.getElementById("highlightDetailsStep").hidden=false;
  document.getElementById("highlightBackBtn").hidden=false;document.getElementById("highlightNextBtn").hidden=true;document.getElementById("highlightSaveBtn").hidden=false;
  renderHighlightCoverChoices();updateHighlightCoverPreview();
});
document.getElementById("highlightBackBtn")?.addEventListener("click",()=>{
  document.getElementById("highlightStoryStep").hidden=false;document.getElementById("highlightDetailsStep").hidden=true;
  document.getElementById("highlightBackBtn").hidden=true;document.getElementById("highlightNextBtn").hidden=false;document.getElementById("highlightSaveBtn").hidden=true;
});
document.getElementById("highlightEditCoverBtn")?.addEventListener("click",()=>{
  const picker=document.getElementById("highlightCoverEditor");picker.hidden=!picker.hidden;
  if(!picker.hidden){renderHighlightCoverChoices();updateHighlightCoverPreview();}
});
document.getElementById("highlightCoverUpload")?.addEventListener("change",async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{highlightCoverImage=await compressHighlightCover(file);highlightCoverStoryId="";updateHighlightCoverPreview();}
  catch(error){document.getElementById("highlightCreateStatus").textContent=error.message||"Cover image could not be used.";}
  event.target.value="";
});
document.getElementById("closeHighlightCreate")?.addEventListener("click",dialogCloseHighlight);
document.getElementById("storyViewerDialog")?.addEventListener("close",()=>{
  const dialog=document.getElementById("storyViewerDialog");dialog._highlightStories=[];dialog.dataset.highlightIndex="";
  const nav=document.getElementById("highlightStoryNav");if(nav)nav.hidden=true;
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
          <div class="ig-profile-username"><strong>${escapeHtml(username)}</strong><button class="profile-menu-trigger" type="button" aria-label="Open menu" title="Menu">☰</button></div>
          <div class="ig-profile-stats"><span class="profile-stat"><b>${posts.length}</b><small>posts</small></span><button class="stat-open profile-stat" data-list="followers" type="button"><b>${followersCount}</b><small>followers</small></button><button class="stat-open profile-stat" data-list="following" type="button"><b>${followingCount}</b><small>following</small></button></div>
        </div>
      </div>
      <div class="ig-profile-bio"><b>${escapeHtml(name)}</b><p>${escapeHtml(data.bio||"")}</p></div>
      <div class="ig-profile-actions"><button type="button" class="profile-edit">Edit profile</button><button type="button" class="profile-share">Share profile</button><button type="button" class="profile-add" aria-label="Discover people">♙+</button></div>
      <div class="ig-highlights"><button class="ig-highlight add-highlight" type="button" aria-label="Create a highlight"><span>＋</span><small>New</small></button></div>
      <div class="ig-profile-tabs" role="tablist"><button class="active" data-profile-tab="posts" type="button" aria-label="Posts" title="Posts"></button><button data-profile-tab="reposts" type="button" aria-label="Reposts" title="Reposts"></button></div>
      <div class="ig-profile-grid"></div>
      <form class="ig-edit-form" hidden><h3>Edit profile</h3><label>Display name<input name="displayName" maxlength="60"></label><label>Username<input name="username" value="${escapeHtml(username)}" minlength="3" maxlength="20" pattern="[a-zA-Z0-9_.]{3,20}" autocomplete="username" required><small>3–20 characters: letters, numbers, dot or underscore.</small></label><label>Bio<textarea name="bio" maxlength="160" rows="3"></textarea></label><button class="ig-save-profile" type="submit">Save changes</button><p class="ig-edit-status" role="status"></p></form>
    `;
    feed.replaceChildren(panel);
    panel.querySelector(".profile-menu-trigger")?.addEventListener("click",openProfileMenu);
    bindAvatarLongPress(panel.querySelector(".ig-profile-avatar"),user.uid,{...data,displayName:name});
    const avatarWrap=panel.querySelector(".ig-avatar-wrap");
    const photoButton=document.createElement("label");photoButton.className="dp-add";photoButton.textContent="＋";photoButton.title="Add profile photo";
    const photoInput=document.createElement("input");photoInput.type="file";photoInput.accept="image/*";photoInput.className="dp-file";photoButton.append(photoInput);avatarWrap.append(photoButton);
    photoInput.addEventListener("change",async e=>{const file=e.target.files?.[0];if(!file)return;if(!file.type.startsWith("image/")){alert("Choose an image file.");return;}if(file.size>4*1024*1024){alert("Image must be under 4 MB.");e.target.value="";return;}try{const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=dataUrl;});const canvas=document.createElement("canvas");canvas.width=320;canvas.height=320;const side=Math.min(img.width,img.height);canvas.getContext("2d").drawImage(img,(img.width-side)/2,(img.height-side)/2,side,side,0,0,320,320);const photoURL=canvas.toDataURL("image/jpeg",0.68);await setDoc(doc(db,"userProfiles",user.uid),{photoURL,updatedAt:serverTimestamp()},{merge:true});panel.querySelector(".ig-profile-avatar").innerHTML='<img alt="Profile photo" src="'+photoURL+'">';}catch(err){console.error(err);alert("Profile photo could not be saved. Check Firestore Rules and image size.");}finally{e.target.value="";}});
    panel.querySelectorAll(".stat-open").forEach(btn=>btn.addEventListener("click",()=>showFollowList(user.uid,btn.dataset.list)));
    const grid=panel.querySelector(".ig-profile-grid");
    let profileTabRequest=0;
    function showTab(tab){
      const tabRequest=++profileTabRequest;
      panel.querySelectorAll("[data-profile-tab]").forEach(b=>b.classList.toggle("active",b.dataset.profileTab===tab));
      grid.replaceChildren();
      if(tab==="posts"){
        if(postsLoadError){grid.innerHTML='<div class="ig-no-posts"><strong>!</strong><b>Posts unavailable</b><span>'+escapeHtml(postsLoadError)+'</span></div>';return;}
        if(!posts.length){grid.innerHTML='<div class="ig-no-posts"><strong>▧</strong><b>Share your first post</b><span>When you share posts, they will appear on your profile.</span></div>';return;}
        posts.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)).forEach(post=>{
          const wrap=document.createElement("div");wrap.className="ig-post-wrap";
          const tile=document.createElement("button");tile.type="button";tile.className="ig-post-tile";tile.textContent=post.text||"";tile.style.background=post.background||POST_BACKGROUNDS[4];tile.addEventListener("click",()=>openPostDetail(post,true));
          const edit=document.createElement("button");edit.type="button";edit.className="profile-edit-post";edit.textContent="Edit";edit.addEventListener("click",()=>openPostEditor(post));
          const del=document.createElement("button");del.type="button";del.className="delete-post profile-delete-post";del.textContent="Delete";del.addEventListener("click",()=>deleteOwnPost(post.id,del,async()=>{const i=posts.findIndex(x=>x.id===post.id);if(i>=0)posts.splice(i,1);showTab("posts");}));
          wrap.append(tile,edit,del);grid.append(wrap);
        });
      }else if(tab==="reposts"){
        grid.innerHTML='<div class="ig-no-posts"><strong>⟳</strong><b>Loading reposts…</b></div>';
        getDocs(query(collection(db,"reposts"),where("uid","==",user.uid),limit(60))).then(snap=>{
          if(!grid.isConnected||tabRequest!==profileTabRequest||!panel.querySelector('[data-profile-tab="reposts"]')?.classList.contains("active"))return;
          grid.replaceChildren();
          if(snap.empty){grid.innerHTML='<div class="ig-no-posts"><strong>⟳</strong><b>No reposts yet</b><span>Posts you repost will appear here.</span></div>';return;}
          snap.docs.sort((a,b)=>(b.data().createdAt?.toMillis?.()||0)-(a.data().createdAt?.toMillis?.()||0)).forEach(d=>{
            const data=d.data(),tile=document.createElement("button");tile.type="button";tile.className="ig-post-tile";
            tile.textContent=data.originalText||"Reposted post";tile.style.background=data.originalBackground||POST_BACKGROUNDS[4];
            tile.setAttribute("aria-label","Open reposted post by "+(data.originalDisplayName||"GRAMORA member"));
            tile.addEventListener("click",()=>{
              if(!data.originalPostId||!data.originalUid)return;
              openPostDetail({id:data.originalPostId,uid:data.originalUid,displayName:data.originalDisplayName||"GRAMORA member",username:data.originalUsername||"",photoURL:data.originalPhotoURL||"",text:data.originalText||"",background:data.originalBackground||POST_BACKGROUNDS[4],createdAt:data.originalCreatedAt||data.createdAt},false);
            });
            grid.append(tile);
          });
        }).catch(err=>{if(tabRequest!==profileTabRequest)return;console.error("Profile reposts:",err);grid.innerHTML='<div class="ig-no-posts"><strong>!</strong><b>Reposts could not be loaded</b><span>Check your connection and Firestore Rules.</span></div>';});
      }else{
        const empty=document.createElement("div");empty.className="ig-no-posts";empty.innerHTML='<strong>▧</strong><b>'+({reels:"No Reels yet",tagged:"No tagged posts yet"}[tab])+'</b><span>This section will show your '+tab+' here.</span>';grid.append(empty);
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
    loadProfileHighlights(user,panel,true);
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
    if(profileLoadToken!==publicProfileLoadToken)return;
    console.error("Profile load error:",error);
    feed.innerHTML='<p class="muted">Could not load profile: '+escapeHtml(error.message||"Please try again.")+'</p>';
  }
}
function escapeHtml(value){
  return String(value||"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}

async function renderFollowRequests(){
  const list=document.getElementById("followRequestsList"),user=auth?.currentUser;
  if(!list||!user)return;
  list.textContent="Loading follow requests…";
  try{
    const snap=await getDocs(query(collection(db,"followRequests"),where("toUid","==",user.uid),limit(100)));
    list.replaceChildren();
    if(snap.empty){list.textContent="No follow requests.";return;}
    for(const requestDoc of snap.docs){
      const item=requestDoc.data(),row=document.createElement("div");row.className="settings-row blocked-account-row";
      const identity=document.createElement("span"),name=document.createElement("b"),handle=document.createElement("small");
      name.textContent=item.fromName||"GRAMORA member";handle.textContent=item.fromUsername?"@"+item.fromUsername:"Wants to follow you";
      identity.append(name,handle);
      const actions=document.createElement("div");actions.className="follow-request-actions";
      const accept=document.createElement("button");accept.type="button";accept.className="blocked-unblock";accept.textContent="Accept";
      const decline=document.createElement("button");decline.type="button";decline.className="blocked-refresh";decline.textContent="Delete";
      accept.addEventListener("click",async()=>{
        accept.disabled=true;decline.disabled=true;
        try{
          const status=await getBlockStatus(user.uid,item.fromUid);
          if(status.blockedByMe||status.blockedMe)throw new Error("Blocked accounts cannot follow each other.");
          await setDoc(doc(db,"follows",item.fromUid+"_"+user.uid),{followerUid:item.fromUid,followingUid:user.uid,createdAt:serverTimestamp()});
          await deleteDoc(doc(db,"followRequests",requestDoc.id));
          await createGramoraNotification(item.fromUid,"follow_accept","accepted your follow request.");
          await renderFollowRequests();
        }catch(error){console.error("Accept follow request failed:",error);accept.disabled=false;decline.disabled=false;alert(error.code==="permission-denied"?"Follow requests ke liye latest Firestore Rules publish karein.":(error.message||"Request accept nahi hui."));}
      });
      decline.addEventListener("click",async()=>{
        decline.disabled=true;
        try{await deleteDoc(doc(db,"followRequests",requestDoc.id));await renderFollowRequests();}
        catch(error){console.error(error);decline.disabled=false;alert("Request delete nahi hui. Firestore Rules check karein.");}
      });
      actions.append(accept,decline);row.append(identity,actions);list.append(row);
    }
  }catch(error){console.error("Follow requests load failed:",error);list.textContent=error.code==="permission-denied"?"Follow requests ke liye latest Firestore Rules publish karein.":"Follow requests load nahi hui.";}
}
async function loadPrivacySettings(){
  const user=auth?.currentUser;if(!user)return;
  const toggle=document.getElementById("privateAccountToggle");
  if(toggle){
    toggle.disabled=true;
    try{const snap=await getDoc(doc(db,"userProfiles",user.uid));toggle.checked=snap.exists()&&snap.data().isPrivate===true;}
    catch(error){console.error(error);toggle.checked=false;}
    finally{toggle.disabled=false;}
  }
  await Promise.all([renderBlockedAccounts(),renderFollowRequests()]);
}
document.getElementById("privateAccountToggle")?.addEventListener("change",async event=>{
  const toggle=event.currentTarget,user=auth?.currentUser;if(!user)return;
  toggle.disabled=true;
  try{
    await updateDoc(doc(db,"userProfiles",user.uid),{isPrivate:toggle.checked,updatedAt:serverTimestamp()});
    const status=document.getElementById("privacyStatus");if(status)status.textContent=toggle.checked?"Your account is now private.":"Your account is now public.";
  }catch(error){
    console.error("Private account update failed:",error);toggle.checked=!toggle.checked;
    const status=document.getElementById("privacyStatus");if(status)status.textContent=error.code==="permission-denied"?"Publish the latest Firestore Rules first.":"Could not update privacy setting.";
  }finally{toggle.disabled=false;}
});

async function getBlockStatus(viewerUid,targetUid){
  if(!viewerUid||!targetUid||viewerUid===targetUid)return {blockedByMe:false,blockedMe:false};
  const [mine,theirs]=await Promise.all([
    getDoc(doc(db,"userBlocks",viewerUid+"_"+targetUid)),
    getDoc(doc(db,"userBlocks",targetUid+"_"+viewerUid))
  ]);
  return {blockedByMe:mine.exists(),blockedMe:theirs.exists()};
}
async function renderBlockedAccounts(){
  const list=document.getElementById("blockedAccountsList"),user=auth?.currentUser;
  if(!list||!user)return;
  list.textContent="Loading blocked accounts…";
  try{
    const snap=await getDocs(query(collection(db,"userBlocks"),where("blockerUid","==",user.uid),limit(100)));
    list.replaceChildren();
    if(snap.empty){list.textContent="You haven't blocked anyone.";return;}
    for(const item of snap.docs){
      const data=item.data(),row=document.createElement("div");row.className="settings-row blocked-account-row";
      const identity=document.createElement("span"),name=document.createElement("b"),username=document.createElement("small");
      name.textContent=data.blockedName||"GRAMORA member";username.textContent=data.blockedUsername?"@"+data.blockedUsername:"Blocked account";
      identity.append(name,username);
      const unblock=document.createElement("button");unblock.type="button";unblock.className="blocked-unblock";unblock.textContent="Unblock";
      unblock.addEventListener("click",async()=>{
        unblock.disabled=true;unblock.textContent="…";
        try{await deleteDoc(doc(db,"userBlocks",item.id));await renderBlockedAccounts();}
        catch(error){console.error("Unblock failed:",error);unblock.disabled=false;unblock.textContent="Unblock";alert("Unblock nahi ho paya. Latest Firestore Rules publish karein.");}
      });
      row.append(identity,unblock);list.append(row);
    }
  }catch(error){console.error("Blocked accounts load failed:",error);list.textContent=error.code==="permission-denied"?"Blocked accounts ke liye latest Firestore Rules publish karein.":"Blocked accounts load nahi ho paye.";}
}
// Settings center
const settingsDialog=document.getElementById("settingsDialog");
function openProfileMenu(){if(!settingsDialog)return;settingsDialog.classList.remove("drawer-closing");settingsDialog.showModal();}
function closeSettingsDrawer(){if(!settingsDialog?.open)return;settingsDialog.classList.add("drawer-closing");window.setTimeout(()=>{settingsDialog.classList.remove("drawer-closing");if(settingsDialog.open)settingsDialog.close();},260);}
document.getElementById("settingsBtn")?.addEventListener("click",openProfileMenu);
document.getElementById("closeCreate")?.addEventListener("click",()=>document.getElementById("createDialog").close());

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

document.getElementById("closeSettings")?.addEventListener("click",closeSettingsDrawer);
settingsDialog?.addEventListener("click",event=>{if(event.target===settingsDialog)closeSettingsDrawer();});
document.querySelectorAll(".settings-tab").forEach(tab=>tab.addEventListener("click",()=>{
  document.querySelectorAll(".settings-tab").forEach(x=>x.classList.toggle("active",x===tab));
  document.querySelectorAll(".settings-panel").forEach(panel=>panel.hidden=panel.dataset.panel!==tab.dataset.settings);
  if(tab.dataset.settings==="privacy")loadPrivacySettings();
}));
document.getElementById("settingsBlockedRefresh")?.addEventListener("click",renderBlockedAccounts);
document.getElementById("followRequestsRefresh")?.addEventListener("click",renderFollowRequests);

document.getElementById("settingsLogout")?.addEventListener("click",async()=>{
  const currentUid=auth?.currentUser?.uid;
  try{
    await signOut(auth);
    savedAccounts=savedAccounts.filter(x=>x.uid!==currentUid);
    saveAccountList();
    const next=savedAccounts[0];
    if(next){
      localStorage.setItem("gramoraActiveAccountUid",next.uid);
      const instance=next.appName==="[DEFAULT]"?{app,auth:getAuth(app),db:getFirestore(app)}:getAccountInstance(next.uid);
      activateAccount(instance);
    }else{
      localStorage.removeItem("gramoraActiveAccountUid");
      gate.hidden=false;
    }
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
document.getElementById("settingsSaved")?.addEventListener("click",()=>{
  settingsDialog.close();document.querySelector('.mobile-nav [data-view="saved"], .sidebar [data-view="saved"]')?.click();
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
