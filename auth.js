import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, updateProfile, sendPasswordResetEmail, signOut } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, runTransaction, serverTimestamp, collection, addDoc, query, orderBy, limit, onSnapshot, getDocs, where } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const configured = firebaseConfig.apiKey !== "PASTE_YOUR_API_KEY" &&
  firebaseConfig.projectId !== "PASTE_YOUR_PROJECT_ID" &&
  firebaseConfig.appId !== "PASTE_YOUR_APP_ID";
const app = configured ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
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


if(auth) onAuthStateChanged(auth,async user=>{
  gate.hidden=!!user;
  if(accountBar) accountBar.hidden=!user;
  if(user){
    try{await ensureProfile(user);renderProfile(user);startPostsFeed(user);}
    catch(error){console.error(error);showMessage("Could not load your profile. Check Firestore Security Rules.",true);}
  }
});

let activeFeedUnsubscribe=null;
let activeView="home";
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
    const identity=document.createElement("div");
    const name=document.createElement("b");name.textContent=data.displayName||"GRAMORA member";
    const meta=document.createElement("small");
    meta.textContent=(data.username?"@"+data.username+" · ":"")+formatPostDate(data.createdAt);
    identity.append(name,meta);head.append(avatar,identity);
    const content=document.createElement("p");content.className="post-text";content.textContent=data.text||"";
    const actions=document.createElement("div");actions.className="post-actions";
    const like=document.createElement("button");like.className="like";like.type="button";like.innerHTML="♡ <span>Like</span>";
    const save=document.createElement("button");save.className="save";save.type="button";save.innerHTML="▣ <span>Save</span>";
    actions.append(like,save);article.append(head,content,actions);feed.append(article);
  });
}
function formatPostDate(timestamp){
  if(!timestamp||!timestamp.toDate)return "Just now";
  return timestamp.toDate().toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});
}
document.addEventListener("gramora:view",event=>{
  activeView=event.detail;
  if(activeView==="profile" && auth?.currentUser) loadProfilePage(auth.currentUser);
  if(activeView==="home"&&auth?.currentUser){
    getDocsForFeed();
  }
});
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
async function loadProfilePage(user){
  const feed=document.getElementById("feed");
  const title=document.getElementById("viewTitle");
  title.textContent="";
  feed.innerHTML='<div class="profile-loading">Loading profile…</div>';
  try{
    const snap=await getDoc(doc(db,"userProfiles",user.uid));
    const data=snap.exists()?snap.data():{};
    let posts=[],postsLoadError="";
    try{
      const postsSnap=await getDocs(query(collection(db,"posts"),where("uid","==",user.uid)));
      posts=postsSnap.docs.map(d=>({id:d.id,...d.data()}));
    }catch(postsError){
      console.error("Profile posts query failed:",postsError);
      postsLoadError=postsError.code==="permission-denied"?"Posts are blocked by Firestore Rules. Your profile is available, but posts cannot be shown until the posts read rule is published.":(postsError.message||"Posts could not be loaded.");
    }
    const username=data.username||"gramora_user";
    const name=data.displayName||user.displayName||"GRAMORA member";
    const panel=document.createElement("section");panel.className="ig-profile";
    panel.innerHTML=`
      <div class="ig-profile-top">
        <div class="ig-avatar-wrap"><div class="ig-profile-avatar">${data.photoURL?'<img alt="Profile photo" src="'+escapeHtml(data.photoURL)+'">':escapeHtml(name.charAt(0).toUpperCase())}</div></div>
        <div class="ig-profile-summary">
          <div class="ig-profile-username"><strong>${escapeHtml(username)}</strong><button class="profile-more" type="button" aria-label="More profile options">•••</button></div>
          <div class="ig-profile-stats"><span><b>${posts.length}</b> posts</span><span><b>${Number(data.followersCount)||0}</b> followers</span><span><b>${Number(data.followingCount)||0}</b> following</span></div>
        </div>
      </div>
      <div class="ig-profile-bio"><b>${escapeHtml(name)}</b><p>${escapeHtml(data.bio||"")}</p></div>
      <div class="ig-profile-actions"><button type="button" class="profile-edit">Edit profile</button><button type="button" class="profile-share">Share profile</button><button type="button" class="profile-add" aria-label="Discover people">♙+</button></div>
      <div class="ig-highlights"><button class="ig-highlight add-highlight" type="button"><span>＋</span><small>New</small></button><div class="ig-highlight"><span>✦</span><small>Highlights</small></div><div class="ig-highlight"><span>♡</span><small>Moments</small></div></div>
      <div class="ig-profile-tabs" role="tablist"><button class="active" data-profile-tab="posts" type="button" aria-label="Posts">▦</button><button data-profile-tab="reels" type="button" aria-label="Reels">▣</button><button data-profile-tab="reposts" type="button" aria-label="Reposts">⟳</button><button data-profile-tab="tagged" type="button" aria-label="Tagged">♙</button></div>
      <div class="ig-profile-grid"></div>
      <form class="ig-edit-form" hidden><h3>Edit profile</h3><label>Display name<input name="displayName" maxlength="60"></label><label>Username<input name="username" value="${escapeHtml(username)}" disabled></label><label>Bio<textarea name="bio" maxlength="160" rows="3"></textarea></label><button class="ig-save-profile" type="submit">Save changes</button><p class="ig-edit-status" role="status"></p></form>
    `;
    feed.replaceChildren(panel);
    const grid=panel.querySelector(".ig-profile-grid");
    function showTab(tab){
      panel.querySelectorAll("[data-profile-tab]").forEach(b=>b.classList.toggle("active",b.dataset.profileTab===tab));
      grid.replaceChildren();
      if(tab==="posts"){
        if(postsLoadError){grid.innerHTML='<div class="ig-no-posts"><strong>!</strong><b>Posts unavailable</b><span>'+escapeHtml(postsLoadError)+'</span></div>';return;}
        if(!posts.length){grid.innerHTML='<div class="ig-no-posts"><strong>▧</strong><b>Share your first post</b><span>When you share posts, they will appear on your profile.</span></div>';return;}
        posts.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)).forEach(post=>{
          const tile=document.createElement("button");tile.type="button";tile.className="ig-post-tile";tile.textContent=post.text||"";
          tile.addEventListener("click",()=>{tile.classList.toggle("expanded");});
          grid.append(tile);
        });
      }else{
        const empty=document.createElement("div");empty.className="ig-no-posts";empty.innerHTML='<strong>▧</strong><b>'+({reels:"No Reels yet",reposts:"No reposts yet",tagged:"No tagged posts yet"}[tab])+'</b><span>This section will show your '+tab+' here.</span>';grid.append(empty);
      }
    }
    showTab("posts");
    panel.querySelectorAll("[data-profile-tab]").forEach(b=>b.addEventListener("click",()=>showTab(b.dataset.profileTab)));
    const editForm=panel.querySelector(".ig-edit-form");
    panel.querySelector(".profile-edit").addEventListener("click",()=>{editForm.hidden=!editForm.hidden;editForm.elements.displayName.value=name;editForm.elements.bio.value=data.bio||"";});
    panel.querySelector(".profile-share").addEventListener("click",async()=>{
      const url=location.href.split("#")[0]+"#profile";
      try{await navigator.clipboard.writeText(url);panel.querySelector(".profile-share").textContent="Link copied";}
      catch{panel.querySelector(".profile-share").textContent=url;}
    });
    panel.querySelector(".profile-add").addEventListener("click",()=>{showTab("tagged");});
    panel.querySelector(".add-highlight").addEventListener("click",()=>alert("Story Highlights will be available when Stories launch."));
    panel.querySelector(".profile-more").addEventListener("click",()=>alert("More profile options will be added in Settings."));
    editForm.addEventListener("submit",async event=>{
      event.preventDefault();
      const newName=editForm.elements.displayName.value.trim(),bio=editForm.elements.bio.value.trim(),status=editForm.querySelector(".ig-edit-status"),save=editForm.querySelector("button[type=submit]");
      if(!newName){status.textContent="Please enter your name.";return;}
      save.disabled=true;status.textContent="Saving…";
      try{
        await updateProfile(auth.currentUser,{displayName:newName});
        await setDoc(doc(db,"userProfiles",user.uid),{displayName:newName,bio,updatedAt:serverTimestamp()},{merge:true});
        panel.querySelector(".ig-profile-bio").innerHTML="<b>"+escapeHtml(newName)+"</b><p>"+escapeHtml(bio)+"</p>";
        status.textContent="Profile updated successfully.";
      }catch(error){status.textContent=authError(error.code);}
      finally{save.disabled=false;}
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
document.getElementById("closeSettings")?.addEventListener("click",()=>settingsDialog.close());
document.querySelectorAll(".settings-tab").forEach(tab=>tab.addEventListener("click",()=>{
  document.querySelectorAll(".settings-tab").forEach(x=>x.classList.toggle("active",x===tab));
  document.querySelectorAll(".settings-panel").forEach(panel=>panel.hidden=panel.dataset.panel!==tab.dataset.settings);
}));
document.getElementById("settingsLogout")?.addEventListener("click",async()=>{
  try{await signOut(auth);settingsDialog.close();}catch(error){document.getElementById("settingsStatus").textContent=authError(error.code);}
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
