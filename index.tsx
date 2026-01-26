
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

// Minimal Error logging
window.addEventListener('error', (e) => {
  document.body.innerHTML += `<div style="color:red;pad:20px">Runtime Error: ${e.message}</div>`;
});

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
