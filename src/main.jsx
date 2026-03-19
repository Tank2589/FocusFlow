import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Register service worker for offline support
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        // Check for updates
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "activated" && navigator.serviceWorker.controller) {
              // New version available -- the app will pick it up on next reload
              console.log("FocusFlow update available");
            }
          });
        });
      })
      .catch((err) => {
        console.error("SW registration failed:", err);
      });
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
