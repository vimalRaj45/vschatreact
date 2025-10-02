import React, { useState, useEffect, useRef } from "react";
import io from "socket.io-client";

const BACKEND_URL = "https://vschats.onrender.com";

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [isLogin, setIsLogin] = useState(true);
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState("");
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");

  // Scroll messages to bottom
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // PWA install
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") console.log("App installed");
    setDeferredPrompt(null);
  };

  // Notification permission on load
  useEffect(() => {
    if ("Notification" in window && Notification.permission !== "granted") {
      Notification.requestPermission().then((perm) => {
        if (perm === "granted") console.log("Notifications allowed ✅");
        else console.log("Notifications denied ❌");
      });
    }
  }, []);

  // Helper: VAPID key
  const urlBase64ToUint8Array = (base64String) => {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  };

  // Login/Register
  const handleAuth = async () => {
    if (!email || !password || (!isLogin && !username)) {
      alert("Please fill all fields");
      return;
    }
    try {
      const url = isLogin ? "/api/login" : "/api/register";
      const res = await fetch(`${BACKEND_URL}${url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isLogin ? { email, password } : { username, email, password }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (isLogin) {
        setCurrentUser(data.user);
        setToken(data.token);
        localStorage.setItem("token", data.token);

        // Service Worker & Push
        if ("serviceWorker" in navigator) {
          const reg = await navigator.serviceWorker.register("/sw.js");
          await navigator.serviceWorker.ready;

          // Unsubscribe old subscription
          const existingSub = await reg.pushManager.getSubscription();
          if (existingSub) await existingSub.unsubscribe();

          // Subscribe new
          const newSub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(data.vapidPublicKey),
          });

          // Send subscription to backend
          await fetch(`${BACKEND_URL}/api/subscribe`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${data.token}`,
            },
            body: JSON.stringify({ subscription: newSub }),
          });

          console.log("✅ Push subscription saved");
        }

        // Socket.io
        socketRef.current = io(BACKEND_URL, { auth: { token: data.token } });
        socketRef.current.on("message", addMessage);
        socketRef.current.on("error", (err) => alert(err.message));

        loadUsers();
      } else {
        alert("Registration successful! Please login.");
        setIsLogin(true);
      }
    } catch (err) {
      alert(err.message || "Operation failed");
    }
  };

  // Load users
  const loadUsers = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setUsers(data);
    } catch (err) {
      console.error("Failed to load users", err);
    }
  };

  // Load messages
  const loadMessages = async (userId) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/messages/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setMessages(data);
    } catch (err) {
      console.error("Failed to load messages", err);
    }
  };

  // Add message
  const addMessage = (msg) => {
    setMessages((prev) => [...prev, msg]);
  };

  // Send message
  const sendMessage = () => {
    if (!messageInput || !selectedUser) return;
    const payload = { receiverId: selectedUser.id, content: messageInput };
    socketRef.current.emit("send_message", payload);
    setMessageInput("");
  };

  // Responsive / mobile styles
  const styles = {
    container: {
      display: "flex",
      height: "100vh",
      fontFamily: "Arial, sans-serif",
      flexDirection: window.innerWidth < 600 ? "column" : "row",
    },
    authContainer: {
      margin: "auto",
      width: "90%",
      maxWidth: 350,
      display: "flex",
      flexDirection: "column",
      gap: 10,
    },
    input: { padding: 10, fontSize: 16, borderRadius: 5, border: "1px solid #ccc" },
    button: {
      padding: 10,
      fontSize: 16,
      borderRadius: 5,
      border: "none",
      backgroundColor: "#007bff",
      color: "white",
      cursor: "pointer",
    },
    usersPanel: {
      width: window.innerWidth < 600 ? "100%" : 250,
      borderRight: "1px solid #eee",
      overflowY: "auto",
      maxHeight: window.innerHeight - 60,
    },
    chatArea: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      height: window.innerHeight,
    },
    messagesContainer: {
      flex: 1,
      padding: 10,
      overflowY: "auto",
      backgroundColor: "#f9f9f9",
    },
    inputArea: {
      display: "flex",
      padding: 10,
      borderTop: "1px solid #eee",
      gap: 5,
      flexWrap: "wrap",
    },
    messageBox: (isOwn) => ({
      maxWidth: "70%",
      padding: 10,
      marginBottom: 10,
      borderRadius: 10,
      backgroundColor: isOwn ? "#007bff" : "#f1f1f1",
      color: isOwn ? "white" : "black",
      alignSelf: isOwn ? "flex-end" : "flex-start",
      wordBreak: "break-word",
    }),
  };

  return (
    <div style={styles.container}>
      {!currentUser && (
        <div style={styles.authContainer}>
          <h2>{isLogin ? "Login" : "Register"}</h2>
          {!isLogin && (
            <input
              type="text"
              placeholder="Username"
              style={styles.input}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          )}
          <input
            type="email"
            placeholder="Email"
            style={styles.input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder="Password"
            style={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button style={styles.button} onClick={handleAuth}>
            {isLogin ? "Login" : "Register"}
          </button>
          <p style={{ fontSize: 14 }}>
            {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
            <span
              style={{ color: "blue", cursor: "pointer" }}
              onClick={() => setIsLogin(!isLogin)}
            >
              {isLogin ? "Register" : "Login"}
            </span>
          </p>
        </div>
      )}

      {currentUser && (
        <>
          <div style={styles.usersPanel}>
            {users.map((u) => (
              <div
                key={u.id}
                onClick={() => {
                  setSelectedUser(u);
                  loadMessages(u.id);
                }}
                style={{
                  padding: 15,
                  cursor: "pointer",
                  backgroundColor: selectedUser?.id === u.id ? "#e9ecef" : "",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    backgroundColor: "green",
                    borderRadius: "50%",
                    display: "inline-block",
                    marginRight: 8,
                  }}
                ></span>
                {u.username}
              </div>
            ))}
          </div>
          <div style={styles.chatArea}>
            <div style={styles.messagesContainer}>
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  style={styles.messageBox(msg.sender_id === currentUser.id)}
                >
                  <div>{msg.content}</div>
                  <small>{new Date(msg.created_at).toLocaleTimeString()}</small>
                </div>
              ))}
              <div ref={messagesEndRef}></div>
            </div>
            <div style={styles.inputArea}>
              <input
                type="text"
                placeholder="Type a message..."
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && sendMessage()}
                disabled={!selectedUser}
                style={{ ...styles.input, flex: 1 }}
              />
              <button style={styles.button} onClick={sendMessage} disabled={!selectedUser}>
                Send
              </button>
              {deferredPrompt && (
                <button style={styles.button} onClick={handleInstallClick}>
                  Install App
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
