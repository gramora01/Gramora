import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, updateProfile, sendPasswordResetEmail, signOut } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const gate = document.getElementById("authGate");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const message = document.getElementById("authMessage");
const title = document.getElementById("authTitle");
const subtitle = document.getElementById("authSubtitle");
const accountBar = document.getElementById("accountBar");
const accountLabel = document.getElementById("accountLabel");
let currentUser = null;

function showMessage(text, isError=false){ message.textContent=text; message.classList.toggle("error",isError); }
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
    showMessage("Account created successfully. Welcome to GRAMORA!");
  }catch(error){showMessage(authError(error.code),true);}
  finally{button.disabled=false;button.textContent="Create my account";}
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
onAuthStateChanged(auth,user=>{
  currentUser=user;
  gate.hidden=!!user;
  accountBar.hidden=!user;
  if(user){accountLabel.textContent=user.displayName||user.email;renderProfile(user);}
});

function renderProfile(user){
  const profileButton=document.querySelector('[data-view="profile"]');
  if(!profileButton||profileButton.dataset.profileBound)return;
  profileButton.dataset.profileBound="yes";
  profileButton.addEventListener("click",()=>{
    const feed=document.getElementById("feed");
    const name=user.displayName||"GRAMORA member";
    feed.innerHTML="";
    const panel=document.createElement("section");panel.className="profile-panel";
    const avatar=document.createElement("div");avatar.className="profile-avatar";avatar.textContent=name.charAt(0).toUpperCase();
    const heading=document.createElement("h2");heading.textContent="Your profile";
    const email=document.createElement("p");email.className="muted";email.textContent=user.email||"";
    const nameLabel=document.createElement("label");nameLabel.textContent="Display name";
    const nameInput=document.createElement("input");nameInput.value=name;nameInput.maxLength=60;
    const save=document.createElement("button");save.type="button";save.textContent="Save profile";
    const status=document.createElement("p");status.className="muted";
    save.addEventListener("click",async()=>{
      const newName=nameInput.value.trim();if(!newName){status.textContent="Please enter your name.";return;}
      save.disabled=true;
      try{await updateProfile(auth.currentUser,{displayName:newName});accountLabel.textContent=newName;avatar.textContent=newName.charAt(0).toUpperCase();status.textContent="Profile updated successfully.";}
      catch(error){status.textContent=authError(error.code);}
      finally{save.disabled=false;}
    });
    panel.append(avatar,heading,email,nameLabel,nameInput,save,status);feed.append(panel);
    document.getElementById("viewTitle").textContent="Your profile";
  },{once:true});
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
    "auth/operation-not-allowed":"Email/password sign-in is not enabled in Firebase yet."
  };
  return messages[code]||"Something went wrong. Please try again.";
}