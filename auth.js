import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, updateProfile, sendPasswordResetEmail, signOut } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
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
document.getElementById("logoutBtn").addEventListener("click",()=>signOut(auth));

if(auth) onAuthStateChanged(auth,async user=>{
  gate.hidden=!!user;
  accountBar.hidden=!user;
  if(user){
    accountLabel.textContent=user.displayName||user.email;
    try{await ensureProfile(user);renderProfile(user);}
    catch(error){console.error(error);showMessage("Could not load your profile. Check Firestore Security Rules.",true);}
  }
});

function renderProfile(user){
  const profileButton=document.querySelector('[data-view="profile"]');
  if(!profileButton||profileButton.dataset.profileBound)return;
  profileButton.dataset.profileBound="yes";
  profileButton.addEventListener("click",async()=>{
    const feed=document.getElementById("feed");
    feed.innerHTML="";
    const panel=document.createElement("section");panel.className="profile-panel";
    const avatar=document.createElement("div");avatar.className="profile-avatar";
    const heading=document.createElement("h2");heading.textContent="Your profile";
    const email=document.createElement("p");email.className="muted";email.textContent=user.email||"";
    const nameLabel=document.createElement("label");nameLabel.textContent="Display name";
    const nameInput=document.createElement("input");nameInput.maxLength=60;
    const bioLabel=document.createElement("label");bioLabel.textContent="Bio";
    const bioInput=document.createElement("input");bioInput.maxLength=160;bioInput.placeholder="Tell the community about yourself";
    const usernameText=document.createElement("p");usernameText.className="muted";
    const save=document.createElement("button");save.type="button";save.textContent="Save profile";
    const status=document.createElement("p");status.className="muted";
    panel.append(avatar,heading,email,usernameText,nameLabel,nameInput,bioLabel,bioInput,save,status);feed.append(panel);
    document.getElementById("viewTitle").textContent="Your profile";
    try{
      const snap=await getDoc(doc(db,"userProfiles",user.uid));
      const data=snap.exists()?snap.data():{};
      nameInput.value=data.displayName||user.displayName||"";
      bioInput.value=data.bio||"";
      usernameText.textContent=data.username?"@"+data.username:"Username not set";
      avatar.textContent=(nameInput.value||"G").charAt(0).toUpperCase();
    }catch(error){status.textContent="Could not load profile. Check Firestore Rules.";return;}
    save.addEventListener("click",async()=>{
      const newName=nameInput.value.trim(),bio=bioInput.value.trim();
      if(!newName){status.textContent="Please enter your name.";return;}
      save.disabled=true;
      try{
        await updateProfile(auth.currentUser,{displayName:newName});
        await setDoc(doc(db,"userProfiles",user.uid),{displayName:newName,bio,updatedAt:serverTimestamp()},{merge:true});
        accountLabel.textContent=newName;avatar.textContent=newName.charAt(0).toUpperCase();
        status.textContent="Profile updated successfully.";
      }catch(error){status.textContent=error.code==="permission-denied"?"Firestore rules blocked this update. Publish the supplied rules.":authError(error.code);}
      finally{save.disabled=false;}
    });
  });
}
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
