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
  const [appLoading, setAppLoading] = useState(true);
  const [autoLoginAttempted, setAutoLoginAttempted] = useState(false);
  
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messageInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Check for existing token on app start with better error handling
  useEffect(() => {
    const initializeApp = async () => {
      try {
        const token = localStorage.getItem('token');
        const userData = localStorage.getItem('userData');
        
        if (token && userData) {
          // Use stored user data immediately for better UX
          const parsedUserData = JSON.parse(userData);
          setCurrentUser(parsedUserData);
          
          // Try to validate token with server in background
          validateToken(token).then(isValid => {
            if (!isValid) {
              console.log('Token validation failed, clearing stored data');
              clearAuthData();
            } else {
              initializeSocket(token);
              loadUsers();
            }
          }).catch(error => {
            console.error('Token validation error:', error);
            // Continue with stored data anyway for offline capability
            initializeSocket(token);
            loadUsers();
          });
        } else {
          setAppLoading(false);
        }
      } catch (error) {
        console.error('App initialization failed:', error);
        clearAuthData();
      } finally {
        setAutoLoginAttempted(true);
        // Set app loading to false after a minimum delay for better UX
        setTimeout(() => setAppLoading(false), 500);
      }
    };

    initializeApp();

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        console.log('Notification permission:', permission);
      });
    }
  }, []);

  const clearAuthData = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userData');
    setCurrentUser(null);
  };

  const validateToken = async (token) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/validate`, {
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      // Check if response is JSON
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error('Server returned non-JSON response');
        return false;
      }
      
      if (res.ok) {
        const userData = await res.json();
        // Update stored user data
        localStorage.setItem('userData', JSON.stringify(userData));
        setCurrentUser(userData);
        return true;
      } else {
        console.log('Token validation failed with status:', res.status);
        return false;
      }
    } catch (error) {
      console.error('Token validation failed:', error);
      // If it's a network error, we'll assume the token might still be valid
      // and let the socket connection handle authentication
      if (error.name === 'TypeError' && error.message.includes('JSON')) {
        console.log('Server might be down, continuing with stored token');
        return true; // Continue with stored token for offline capability
      }
      return false;
    }
  };

  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, typingUsers]);

  // Auto-focus message input when selecting a user
  useEffect(() => {
    if (selectedUser) {
      setTimeout(() => {
        messageInputRef.current?.focus();
      }, 100);
    }
  }, [selectedUser]);

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

  // Enhanced authentication handlers
  const handleAuth = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const email = formData.get('email').trim();
    const password = formData.get('password');
    const username = formData.get('username')?.trim();

    if (!email || !password || (!isLogin && !username)) {
      alert('Please fill all fields');
      return;
    }

    // Basic validation
    if (!isLogin && username && username.length < 3) {
      alert('Username must be at least 3 characters long');
      return;
    }

    if (password.length < 6) {
      alert('Password must be at least 6 characters long');
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

      // Check if response is JSON
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await res.text();
        console.error('Server returned non-JSON response:', text.substring(0, 200));
        throw new Error('Server error. Please try again later.');
      }
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');

      if (isLogin) {
        // Store authentication data
        localStorage.setItem('token', data.token);
        localStorage.setItem('userData', JSON.stringify(data.user));
        
        setCurrentUser(data.user);
        initializeSocket(data.token);
        initializePushNotifications(data);
        loadUsers();
        
        // Show welcome message
        setTimeout(() => {
          alert(`Welcome back, ${data.user.username}!`);
        }, 100);
      } else {
        alert('Registration successful! Please login with your credentials.');
        setIsLogin(true);
        // Clear form
        e.target.reset();
      }
    } catch (err) {
      alert(err.message || 'Operation failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Enhanced Socket initialization with better error handling
  const initializeSocket = (token) => {
    setConnectionStatus('connecting');
    
    try {
      socketRef.current = io(BACKEND_URL, {
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      socketRef.current.on('connect', () => {
        setConnectionStatus('connected');
        console.log('Connected to server');
      });

      socketRef.current.on('disconnect', (reason) => {
        setConnectionStatus('disconnected');
        console.log('Disconnected from server:', reason);
      });

      socketRef.current.on('connect_error', (error) => {
        setConnectionStatus('error');
        console.error('Connection error:', error);
        
        // Check if it's an authentication error
        if (error.message.includes('auth') || error.message.includes('401')) {
          console.log('Authentication failed, logging out');
          handleLogout();
          alert('Session expired. Please login again.');
        }
      });

      socketRef.current.on('reconnect_attempt', (attempt) => {
        setConnectionStatus(`reconnecting (${attempt}/5)`);
      });

      socketRef.current.on('reconnect_failed', () => {
        setConnectionStatus('failed');
        alert('Unable to connect to server. Please check your internet connection.');
      });

      socketRef.current.on('message', (message) => {
        setMessages(prev => [...prev, { ...message, isOwn: false }]);
        
        // Show notification for new messages when app is in background
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          new Notification(`New message from ${selectedUser?.username || 'Someone'}`, {
            body: message.content.length > 50 ? message.content.substring(0, 50) + '...' : message.content,
            icon: '/favicon.ico',
            tag: 'new-message'
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
        console.error('Socket error:', err);
        if (err.message && !err.message.includes('auth')) {
          alert(err.message || 'A connection error occurred');
        }
      });

    } catch (error) {
      console.error('Socket initialization failed:', error);
      setConnectionStatus('error');
    }
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

  // Load users list with better error handling
  const loadUsers = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        handleLogout();
        return;
      }

      const res = await fetch(`${BACKEND_URL}/api/users`, {
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      // Check if response is JSON
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error('Server returned non-JSON response for users');
        // Continue with empty users list rather than failing completely
        setUsers([]);
        return;
      }
      
      if (res.ok) {
        const usersData = await res.json();
        setUsers(usersData);
      } else if (res.status === 401) {
        // Token expired
        handleLogout();
        alert('Your session has expired. Please login again.');
      } else {
        throw new Error('Failed to load users');
      }
    } catch (error) {
      console.error('Failed to load users:', error);
      // Don't show alert for network errors, just continue with empty list
      if (error.name !== 'TypeError') {
        alert('Failed to load users. Please check your connection and try again.');
      }
    }
  };

  // Load messages for selected user
  const loadMessages = async (userId) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${BACKEND_URL}/api/messages/${userId}`, {
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      // Check if response is JSON
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error('Server returned non-JSON response for messages');
        setMessages([]);
        return;
      }
      
      if (res.ok) {
        const messagesData = await res.json();
        setMessages(messagesData);
        const user = users.find(user => user.id === userId);
        setSelectedUser(user);
        setShowSidebar(false); // Close sidebar on mobile when selecting a chat
      } else if (res.status === 401) {
        handleLogout();
        alert('Your session has expired. Please login again.');
      } else {
        throw new Error('Failed to load messages');
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
      // Don't show alert for network errors
      if (error.name !== 'TypeError') {
        alert('Failed to load messages. Please try again.');
      }
    }
  };

  // Enhanced send message with better error handling
  const sendMessage = async () => {
    const content = newMessage.trim();
    if (!content || !selectedUser || !socketRef.current) return;

    // Stop typing indicator
    handleTypingStop();

    // Optimistically add message to UI
    const optimisticMessage = {
      id: Date.now(), // Temporary ID
      content,
      sender_id: currentUser.id,
      created_at: new Date().toISOString(),
      isOwn: true,
      pending: true
    };
    
    setMessages(prev => [...prev, optimisticMessage]);
    setNewMessage('');

    try {
      socketRef.current.emit('send_message', {
        receiverId: selectedUser.id,
        content
      });
      
      // Remove pending status after a short delay (simulate delivery)
      setTimeout(() => {
        setMessages(prev => prev.map(msg => 
          msg.id === optimisticMessage.id 
            ? { ...msg, pending: false }
            : msg
        ));
      }, 1000);
      
    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove optimistic message on error
      setMessages(prev => prev.filter(msg => msg.id !== optimisticMessage.id));
      alert('Failed to send message. Please try again.');
    }
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
    } else if (diffInHours < 48) {
      return 'Yesterday ' + formatTime(dateString);
    } else {
      return date.toLocaleDateString() + ' ' + formatTime(dateString);
    }
  };

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return '#00b300';
      case 'connecting': return '#ffa500';
      case 'error': return '#ff4444';
      case 'reconnecting': return '#ffa500';
      default: return '#65676b';
    }
  };

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to logout?')) {
      clearAuthData();
      setCurrentUser(null);
      setSelectedUser(null);
      setMessages([]);
      setUsers([]);
      socketRef.current?.disconnect();
      alert('You have been logged out successfully.');
    }
  };

  const toggleSidebar = () => {
    setShowSidebar(!showSidebar);
  };

  const handleBackToContacts = () => {
    setSelectedUser(null);
    setMessages([]);
    setShowSidebar(true);
  };

  // Show loading screen while checking authentication
  if (appLoading) {
    return (
      <div className="app loading-container">
        <div className="loading-content">
          <div className="loading-spinner"></div>
          <h2>VSChats</h2>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

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
                  placeholder="Username (min. 3 characters)"
                  className="form-input"
                  required
                  minLength="3"
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
                placeholder="Password (min. 6 characters)"
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
                disabled={loading}
              >
                {isLogin ? 'Sign Up' : 'Sign In'}
              </button>
            </p>
          </div>

          {autoLoginAttempted && (
            <div className="auth-features">
              <h4>Features:</h4>
              <ul>
                <li>🔐 Auto-login on return</li>
                <li>💬 Real-time messaging</li>
                <li>👥 Online status</li>
                <li>📱 Mobile friendly</li>
                <li>🔔 Push notifications</li>
              </ul>
            </div>
          )}
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
            <h3 className="section-title">Contacts ({users.length})</h3>
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
            {users.length === 0 ? (
              <div className="no-users">
                <p>No contacts found</p>
                <button onClick={loadUsers} className="retry-btn">
                  Try Again
                </button>
              </div>
            ) : (
              users.map(user => (
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
              ))
            )}
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
                    <p>Start a conversation by sending a message below</p>
                  </div>
                ) : (
                  messages.map((message, index) => {
                    const isOwn = message.sender_id === currentUser.id;
                    const showAvatar = index === 0 || 
                      messages[index - 1]?.sender_id !== message.sender_id;
                    
                    return (
                      <div
                        key={message.id || index}
                        className={`message ${isOwn ? 'own' : 'other'} ${showAvatar ? 'with-avatar' : ''} ${message.pending ? 'pending' : ''}`}
                      >
                        {!isOwn && showAvatar && (
                          <div className="message-avatar">
                            {selectedUser.username?.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="message-content">
                          <div className="message-bubble">
                            {message.content}
                            {message.pending && (
                              <span className="pending-indicator">⏳</span>
                            )}
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
                  placeholder="Type a message... (Press Enter to send)"
                  className="message-input"
                  disabled={connectionStatus !== 'connected'}
                />
                <button
                  onClick={sendMessage}
                  disabled={!newMessage.trim() || connectionStatus !== 'connected'}
                  className="send-btn"
                  title={connectionStatus === 'connected' ? "Send message" : "Connecting..."}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                  </svg>
                </button>
              </div>
              {connectionStatus !== 'connected' && (
                <div className="connection-warning">
                  ⚠️ {connectionStatus === 'connecting' ? 'Connecting to server...' : 'Connection lost. Trying to reconnect...'}
                </div>
              )}
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
              <h2>Welcome to VSChats, {currentUser.username}! 👋</h2>
              <p>Select a conversation from the sidebar to start messaging</p>
              <div className="connection-info">
                <span 
                  className="status-dot"
                  style={{ backgroundColor: getConnectionStatusColor() }}
                ></span>
                Server: {connectionStatus}
              </div>
              
              <div className="welcome-actions">
                <button 
                  className="new-chat-btn"
                  onClick={toggleSidebar}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                  </svg>
                  Browse Contacts
                </button>
                
                <button 
                  className="refresh-btn large"
                  onClick={loadUsers}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                  </svg>
                  Refresh Contacts
                </button>
              </div>
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
