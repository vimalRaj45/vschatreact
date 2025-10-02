// App.js
import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

const BACKEND_URL = "https://vschats.onrender.com";

const App = () => {
  const [currentUser, setCurrentUser] = useState(null);
  const [isLogin, setIsLogin] = useState(true);
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [isTyping, setIsTyping] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messageInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Check for existing token on app start
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      validateToken(token);
    }
    
    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const validateToken = async (token) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/validate`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (res.ok) {
        const userData = await res.json();
        setCurrentUser(userData);
        initializeSocket(token);
        loadUsers();
      } else {
        localStorage.removeItem('token');
      }
    } catch (error) {
      console.error('Token validation failed:', error);
      localStorage.removeItem('token');
    }
  };

  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, typingUsers]);

  // Typing indicators
  const handleTypingStart = () => {
    if (!selectedUser || !socketRef.current || isTyping) return;
    
    setIsTyping(true);
    socketRef.current.emit('typing_start', { receiverId: selectedUser.id });
    
    // Stop typing after 2 seconds of inactivity
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      handleTypingStop();
    }, 2000);
  };

  const handleTypingStop = () => {
    if (!selectedUser || !socketRef.current || !isTyping) return;
    
    setIsTyping(false);
    socketRef.current.emit('typing_stop', { receiverId: selectedUser.id });
    clearTimeout(typingTimeoutRef.current);
  };

  // Authentication handlers
  const handleAuth = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const email = formData.get('email');
    const password = formData.get('password');
    const username = formData.get('username');

    if (!email || !password || (!isLogin && !username)) {
      alert('Please fill all fields');
      return;
    }

    setLoading(true);
    try {
      const url = isLogin ? `${BACKEND_URL}/api/login` : `${BACKEND_URL}/api/register`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isLogin ? { email, password } : { username, email, password })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (isLogin) {
        localStorage.setItem('token', data.token);
        setCurrentUser(data.user);
        initializeSocket(data.token);
        initializePushNotifications(data);
        loadUsers();
      } else {
        alert('Registration successful! Please login.');
        setIsLogin(true);
        // Clear form
        e.target.reset();
      }
    } catch (err) {
      alert(err.message || 'Operation failed');
    } finally {
      setLoading(false);
    }
  };

  // Socket initialization
  const initializeSocket = (token) => {
    setConnectionStatus('connecting');
    
    socketRef.current = io(BACKEND_URL, {
      auth: { token },
      transports: ['websocket', 'polling']
    });

    socketRef.current.on('connect', () => {
      setConnectionStatus('connected');
      console.log('Connected to server');
    });

    socketRef.current.on('disconnect', () => {
      setConnectionStatus('disconnected');
    });

    socketRef.current.on('connect_error', (error) => {
      setConnectionStatus('error');
      console.error('Connection error:', error);
    });

    socketRef.current.on('message', (message) => {
      setMessages(prev => [...prev, { ...message, isOwn: false }]);
      
      // Show notification for new messages when app is in background
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(`New message from ${selectedUser?.username || 'Someone'}`, {
          body: message.content,
          icon: '/favicon.ico'
        });
      }
    });

    socketRef.current.on('user_online', (userId) => {
      setOnlineUsers(prev => new Set([...prev, userId]));
    });

    socketRef.current.on('user_offline', (userId) => {
      setOnlineUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(userId);
        return newSet;
      });
    });

    socketRef.current.on('typing_start', (data) => {
      setTypingUsers(prev => new Set([...prev, data.userId]));
    });

    socketRef.current.on('typing_stop', (data) => {
      setTypingUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(data.userId);
        return newSet;
      });
    });

    socketRef.current.on('message_delivered', (data) => {
      // Update message status if needed
      console.log('Message delivered:', data);
    });

    socketRef.current.on('error', (err) => {
      alert(err.message);
    });
  };

  // Push notifications
  const initializePushNotifications = async (data) => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(data.vapidPublicKey)
        });
        
        await fetch(`${BACKEND_URL}/api/subscribe`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${data.token}`
          },
          body: JSON.stringify({ subscription: sub })
        });
      } catch (error) {
        console.error('Push notification setup failed:', error);
      }
    }
  };

  // Load users list
  const loadUsers = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${BACKEND_URL}/api/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (res.ok) {
        const usersData = await res.json();
        setUsers(usersData);
      } else {
        throw new Error('Failed to load users');
      }
    } catch (error) {
      console.error('Failed to load users:', error);
      alert('Failed to load users. Please try again.');
    }
  };

  // Load messages for selected user
  const loadMessages = async (userId) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${BACKEND_URL}/api/messages/${userId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (res.ok) {
        const messagesData = await res.json();
        setMessages(messagesData);
        const user = users.find(user => user.id === userId);
        setSelectedUser(user);
        setShowSidebar(false); // Close sidebar on mobile when selecting a chat
        messageInputRef.current?.focus();
      } else {
        throw new Error('Failed to load messages');
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
      alert('Failed to load messages. Please try again.');
    }
  };

  // Send message
  const sendMessage = () => {
    const content = newMessage.trim();
    if (!content || !selectedUser || !socketRef.current) return;

    // Stop typing indicator
    handleTypingStop();

    socketRef.current.emit('send_message', {
      receiverId: selectedUser.id,
      content
    });

    // Optimistically add message to UI
    const optimisticMessage = {
      id: Date.now(), // Temporary ID
      content,
      sender_id: currentUser.id,
      created_at: new Date().toISOString(),
      isOwn: true
    };
    
    setMessages(prev => [...prev, optimisticMessage]);
    setNewMessage('');
    messageInputRef.current?.focus();
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleInputChange = (e) => {
    setNewMessage(e.target.value);
    if (e.target.value.trim()) {
      handleTypingStart();
    } else {
      handleTypingStop();
    }
  };

  const formatTime = (dateString) => {
    return new Date(dateString).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const formatMessageTime = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now - date) / (1000 * 60 * 60);
    
    if (diffInHours < 24) {
      return formatTime(dateString);
    } else {
      return date.toLocaleDateString() + ' ' + formatTime(dateString);
    }
  };

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return '#00b300';
      case 'connecting': return '#ffa500';
      case 'error': return '#ff4444';
      default: return '#65676b';
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setCurrentUser(null);
    setSelectedUser(null);
    setMessages([]);
    socketRef.current?.disconnect();
  };

  const toggleSidebar = () => {
    setShowSidebar(!showSidebar);
  };

  const handleBackToContacts = () => {
    setSelectedUser(null);
    setMessages([]);
    setShowSidebar(true);
  };

  if (!currentUser) {
    return (
      <div className="app auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <h1 className="app-title">💬 VSChats</h1>
            <p className="app-subtitle">Real-time messaging platform</p>
          </div>
          
          <form onSubmit={handleAuth} className="auth-form">
            <h2 className="auth-title">
              {isLogin ? 'Welcome Back' : 'Create Account'}
            </h2>
            
            {!isLogin && (
              <div className="input-group">
                <input
                  type="text"
                  name="username"
                  placeholder="Username"
                  className="form-input"
                  required
                />
              </div>
            )}
            
            <div className="input-group">
              <input
                type="email"
                name="email"
                placeholder="Email address"
                className="form-input"
                required
              />
            </div>
            
            <div className="input-group">
              <input
                type="password"
                name="password"
                placeholder="Password"
                className="form-input"
                required
                minLength="6"
              />
            </div>
            
            <button 
              type="submit" 
              className="auth-btn"
              disabled={loading}
            >
              {loading ? (
                <div className="spinner"></div>
              ) : (
                isLogin ? 'Sign In' : 'Create Account'
              )}
            </button>
          </form>
          
          <div className="auth-switch">
            <p>
              {isLogin ? "Don't have an account? " : "Already have an account? "}
              <button 
                type="button" 
                className="switch-btn"
                onClick={() => setIsLogin(!isLogin)}
              >
                {isLogin ? 'Sign Up' : 'Sign In'}
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {/* Sidebar for Contacts */}
      <div className={`sidebar ${showSidebar ? 'active' : ''}`}>
        <div className="sidebar-header">
          <div className="user-profile">
            <div className="avatar">
              {currentUser.username?.charAt(0).toUpperCase()}
            </div>
            <div className="user-info">
              <span className="username">{currentUser.username}</span>
              <div className="connection-status">
                <span 
                  className="status-dot"
                  style={{ backgroundColor: getConnectionStatusColor() }}
                ></span>
                <span className="status-text">
                  {connectionStatus.charAt(0).toUpperCase() + connectionStatus.slice(1)}
                </span>
              </div>
            </div>
          </div>
          <button 
            className="logout-btn"
            onClick={handleLogout}
            title="Logout"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
            </svg>
          </button>
        </div>

        <div className="users-section">
          <div className="section-header">
            <h3 className="section-title">Contacts</h3>
            <button 
              className="refresh-btn"
              onClick={loadUsers}
              title="Refresh contacts"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
              </svg>
            </button>
          </div>
          <div className="users-list">
            {users.map(user => (
              <div
                key={user.id}
                className={`user-item ${selectedUser?.id === user.id ? 'selected' : ''}`}
                onClick={() => loadMessages(user.id)}
              >
                <div className="user-avatar">
                  {user.username?.charAt(0).toUpperCase()}
                  {onlineUsers.has(user.id) && <span className="online-dot"></span>}
                </div>
                <div className="user-details">
                  <span className="user-name">{user.username}</span>
                  <span className="user-status">
                    {onlineUsers.has(user.id) ? 'Online' : 'Offline'}
                  </span>
                </div>
                {typingUsers.has(user.id) && (
                  <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className="chat-area">
        {selectedUser ? (
          <>
            {/* Mobile Navigation Bar */}
            <div className="chat-header">
              <button 
                className="back-btn"
                onClick={handleBackToContacts}
                title="Back to contacts"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                </svg>
              </button>
              
              <div className="chat-user">
                <div className="chat-user-avatar">
                  {selectedUser.username?.charAt(0).toUpperCase()}
                  {onlineUsers.has(selectedUser.id) && <span className="online-dot"></span>}
                </div>
                <div className="chat-user-info">
                  <span className="chat-username">{selectedUser.username}</span>
                  <span className="chat-status">
                    {typingUsers.has(selectedUser.id) ? (
                      <span className="typing-text">typing...</span>
                    ) : (
                      onlineUsers.has(selectedUser.id) ? 'Online' : 'Offline'
                    )}
                  </span>
                </div>
              </div>

              <button 
                className="menu-btn"
                onClick={toggleSidebar}
                title="Menu"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
                </svg>
              </button>
            </div>

            <div className="messages-container">
              <div className="messages">
                {messages.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-illustration">
                      <svg width="80" height="80" viewBox="0 0 24 24" fill="#0084ff">
                        <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>
                      </svg>
                    </div>
                    <h3>No messages yet</h3>
                    <p>Start a conversation by sending a message</p>
                  </div>
                ) : (
                  messages.map((message, index) => {
                    const isOwn = message.sender_id === currentUser.id;
                    const showAvatar = index === 0 || 
                      messages[index - 1]?.sender_id !== message.sender_id;
                    
                    return (
                      <div
                        key={message.id || index}
                        className={`message ${isOwn ? 'own' : 'other'} ${showAvatar ? 'with-avatar' : ''}`}
                      >
                        {!isOwn && showAvatar && (
                          <div className="message-avatar">
                            {selectedUser.username?.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="message-content">
                          <div className="message-bubble">
                            {message.content}
                          </div>
                          <div className="message-time">
                            {formatMessageTime(message.created_at)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            <div className="message-input-container">
              <div className="message-input-wrapper">
                <input
                  ref={messageInputRef}
                  type="text"
                  value={newMessage}
                  onChange={handleInputChange}
                  onKeyPress={handleKeyPress}
                  placeholder="Type a message..."
                  className="message-input"
                />
                <button
                  onClick={sendMessage}
                  disabled={!newMessage.trim()}
                  className="send-btn"
                  title="Send message"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                  </svg>
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Mobile Navigation Bar for Contacts View */}
            <div className="chat-header">
              <div className="user-profile">
                <div className="avatar">
                  {currentUser.username?.charAt(0).toUpperCase()}
                </div>
                <div className="user-info">
                  <span className="username">{currentUser.username}</span>
                  <div className="connection-status">
                    <span 
                      className="status-dot"
                      style={{ backgroundColor: getConnectionStatusColor() }}
                    ></span>
                    <span className="status-text">
                      {connectionStatus.charAt(0).toUpperCase() + connectionStatus.slice(1)}
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="header-actions">
                <button 
                  className="refresh-btn"
                  onClick={loadUsers}
                  title="Refresh contacts"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                  </svg>
                </button>
                
                <button 
                  className="logout-btn"
                  onClick={handleLogout}
                  title="Logout"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
                  </svg>
                </button>
              </div>
            </div>

            <div className="no-chat-selected">
              <div className="welcome-illustration">
                <svg width="150" height="150" viewBox="0 0 24 24" fill="#0084ff">
                  <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>
                </svg>
              </div>
              <h2>Welcome to VSChats</h2>
              <p>Select a conversation to start messaging</p>
              <div className="connection-info">
                <span 
                  className="status-dot"
                  style={{ backgroundColor: getConnectionStatusColor() }}
                ></span>
                Server: {connectionStatus}
              </div>
              
              <button 
                className="new-chat-btn"
                onClick={toggleSidebar}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                </svg>
                Start New Chat
              </button>
            </div>
          </>
        )}
      </div>

      {/* Overlay for mobile sidebar */}
      {showSidebar && (
        <div 
          className="sidebar-overlay"
          onClick={() => setShowSidebar(false)}
        />
      )}
    </div>
  );
};

// Utility function for VAPID key conversion
const urlBase64ToUint8Array = (base64String) => {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

export default App;
