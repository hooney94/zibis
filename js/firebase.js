import { firebaseConfig } from "./config.js";

export function initFirebase() {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  return {
    db: firebase.database(),
    auth: firebase.auth()
  };
}
