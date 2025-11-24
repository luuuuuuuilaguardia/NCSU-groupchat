import React, { useEffect, useMemo, useRef, useState } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import './index.css';

const API_URL = import.meta.env.VITE_BACKEND_URL;

if (!API_URL) {
  throw new Error('VITE_BACKEND_URL is not defined. Please set it in your frontend environment variables.');
}

const api = axios.create({
  baseURL: API_URL
});

const buildConversationId = (userId, otherId) => {
  if (!userId || !otherId) return '';
  const sorted = [userId, otherId].sort();
  return `direct:${sorted[0]}:${sorted[1]}`;
};

const reactionEmojis = ['👍', '❤️', '😂', '🎉', '😮', '😢'];

function App() {
  const [mode, setMode] = useState('login');
  const [authForm, setAuthForm] = useState({
    username: '',
    email: '',
    password: '',
    identifier: '',
    otp: '',
    newPassword: ''
  });
  const [passwordVisibility, setPasswordVisibility] = useState({
    login: false,
    register: false,
    otp: false
  });
  const [authLoading, setAuthLoading] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });

  const [friends, setFriends] = useState([]);
  const [groups, setGroups] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [messages, setMessages] = useState({});
  const [activeConversation, setActiveConversation] = useState(null);
  const [chatInput, setChatInput] = useState('');
  const [typingState, setTypingState] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [groupForm, setGroupForm] = useState({ name: '', members: [] });
  const [addMemberForm, setAddMemberForm] = useState({ groupId: null, members: [] });
  const [statusMessage, setStatusMessage] = useState('');
  const [activeTab, setActiveTab] = useState('chat');
  const socketRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    if (!token) {
      delete api.defaults.headers.common.Authorization;
      return;
    }

    api.defaults.headers.common.Authorization = `Bearer ${token}`;
    bootstrapData();

    const socket = io(API_URL, { auth: { token } });
    socketRef.current = socket;

    socket.on('receive_message', handleIncomingMessage);
    socket.on('message_reaction', handleReactionUpdate);
    socket.on('typing', handleTypingEvent);
    socket.on('online_status', setOnlineUsers);

    return () => {
      socket.off('receive_message');
      socket.off('message_reaction');
      socket.off('typing');
      socket.off('online_status');
      socket.disconnect();
    };
  }, [token]);

  const bootstrapData = async () => {
    try {
      await Promise.all([fetchFriends(), fetchGroups(), fetchRequests()]);
    } catch (error) {
      console.error('Bootstrap failed', error);
    }
  };

  const fetchFriends = async () => {
    const { data } = await api.get('/api/friends/list');
    setFriends(data);
  };

  const fetchRequests = async () => {
    const { data } = await api.get('/api/friends/requests');
    setFriendRequests(data);
  };

  const fetchGroups = async () => {
    const { data } = await api.get('/api/groups');
    setGroups(data);
  };

  const handleIncomingMessage = (payload) => {
    setMessages((prev) => {
      const formatted = formatMessageFromPayload(payload);
      const existing = prev[formatted.conversationId] || [];
      return {
        ...prev,
        [formatted.conversationId]: [...existing, formatted]
      };
    });
  };

  const handleReactionUpdate = ({ messageId, reactions }) => {
    setMessages((prev) => {
      const updated = {};
      Object.keys(prev).forEach((key) => {
        updated[key] = prev[key].map((msg) =>
          msg.id === messageId ? { ...msg, reactions } : msg
        );
      });
      return updated;
    });
  };

  const handleTypingEvent = ({ from, groupId, userId: sourceUserId }) => {
    const typingUserId = from || sourceUserId;
    if (!typingUserId || typingUserId === user?.id || typingUserId === user?._id) {
      return;
    }
    setTypingState({ typingUserId, groupId });
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => setTypingState(null), 2000);
  };

  const formatMessageFromPayload = (payload) => {
    const senderId = payload.sender?.id || payload.senderId?._id || payload.senderId;
    const senderName = payload.sender?.username || payload.senderId?.username || payload.senderName;
    return {
      id: payload._id || payload.id || payload.messageId,
      conversationId: payload.conversationId,
      senderId,
      senderName,
      messageText: payload.messageText,
      createdAt: payload.createdAt || new Date().toISOString(),
      reactions: payload.reactions || []
    };
  };

  const selectConversation = async (conversation) => {
    setActiveConversation(conversation);
    const conversationId =
      conversation.type === 'group'
        ? `group:${conversation.id}`
        : buildConversationId(user.id || user._id, conversation.id);

    if (!messages[conversationId]) {
      const { data } = await api.get(`/api/messages/${conversationId}`);
      setMessages((prev) => ({
        ...prev,
        [conversationId]: data.map((msg) =>
          formatMessageFromPayload({
            ...msg,
            sender: {
              id: msg.senderId?._id || msg.senderId,
              username: msg.senderId?.username || msg.sender?.username
            },
            reactions:
              msg.reactions?.map((reaction) => ({
                userId: reaction.userId?._id || reaction.userId,
                username: reaction.userId?.username,
                emoji: reaction.emoji
              })) || []
          })
        )
      }));
    }
  };

  const currentConversationId = useMemo(() => {
    if (!activeConversation || !user) return null;
    return activeConversation.type === 'group'
      ? `group:${activeConversation.id}`
      : buildConversationId(user.id || user._id, activeConversation.id);
  }, [activeConversation, user]);

  const currentMessages = currentConversationId ? messages[currentConversationId] || [] : [];

  const sendMessage = () => {
    if (!chatInput.trim() || !socketRef.current || !activeConversation) return;
    const payload =
      activeConversation.type === 'group'
        ? { groupId: activeConversation.id, messageText: chatInput }
        : { recipientId: activeConversation.id, messageText: chatInput };
    socketRef.current.emit('send_message', payload);
    setChatInput('');
  };

  const sendTypingSignal = () => {
    if (!socketRef.current || !activeConversation) return;
    socketRef.current.emit('typing', {
      groupId: activeConversation.type === 'group' ? activeConversation.id : undefined,
      recipientId: activeConversation.type === 'direct' ? activeConversation.id : undefined
    });
  };

  const reactToMessage = (message, emoji) => {
    if (!socketRef.current) return;
    socketRef.current.emit('react_message', {
      messageId: message.id,
      emoji,
      groupId: activeConversation?.type === 'group' ? activeConversation.id : undefined,
      recipientId: activeConversation?.type === 'direct' ? activeConversation.id : undefined
    });
  };

  const handleRegister = async () => {
    setAuthLoading(true);
    try {
      const { data } = await api.post('/api/auth/register', {
        username: authForm.username,
        email: authForm.email,
        password: authForm.password
      });
      finishAuth(data);
    } catch (error) {
      const errorMsg = error.response?.data?.message || 'Registration failed';
      const errors = error.response?.data?.errors;
      if (errors && errors.length > 0) {
        const errorDetails = errors.map(e => `${e.field}: ${e.msg}`).join('\n');
        alert(`${errorMsg}\n\n${errorDetails}`);
      } else {
        alert(errorMsg);
      }
      console.error('Registration error:', error.response?.data || error.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogin = async () => {
    setAuthLoading(true);
    try {
      const { data } = await api.post('/api/auth/login', {
        identifier: authForm.identifier,
        password: authForm.password
      });
      finishAuth(data);
    } catch (error) {
      const errorMsg = error.response?.data?.message || 'Login failed';
      const errors = error.response?.data?.errors;
      if (errors && errors.length > 0) {
        const errorDetails = errors.map(e => `${e.field}: ${e.msg}`).join('\n');
        alert(`${errorMsg}\n\n${errorDetails}`);
      } else {
        alert(errorMsg);
      }
      console.error('Login error:', error.response?.data || error.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    try {
      await api.post('/api/auth/forgot-password', { email: authForm.email });
      setStatusMessage('OTP sent to your email');
      setMode('otp');
    } catch (error) {
      alert('Failed to send OTP');
    }
  };

  const handleVerifyOtp = async () => {
    try {
      await api.post('/api/auth/verify-otp', {
        email: authForm.email,
        otp: authForm.otp,
        newPassword: authForm.newPassword
      });
      setStatusMessage('Password updated. Please login.');
      setMode('login');
    } catch (error) {
      alert('Failed to verify OTP');
    }
  };

  const finishAuth = (data) => {
    const authedUser = { ...data.user, id: data.user._id };
    setUser(authedUser);
    setToken(data.token);
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(authedUser));
    setMode('app');
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    setActiveConversation(null);
    setMessages({});
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setMode('login');
  };

  const searchUsers = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const { data } = await api.get(`/api/user/search?q=${searchQuery}`);
    setSearchResults(data);
  };

  const sendFriendRequest = async (receiverId) => {
    try {
      await api.post('/api/friends/request', { receiverId });
      setStatusMessage('Friend request sent');
      setSearchQuery('');
      setSearchResults([]);
    } catch (error) {
      const errorMsg = error.response?.data?.message || 'Failed to send friend request';
      alert(errorMsg);
      console.error('Friend request error:', error.response?.data || error.message);
    }
  };

  const respondToFriendRequest = async (requestId, action) => {
    await api.post(`/api/friends/${action}`, { requestId });
    fetchFriends();
    fetchRequests();
  };

  const createGroup = async () => {
    if (!groupForm.name.trim()) {
      alert('Group name required');
      return;
    }
    try {
      await api.post('/api/groups', { groupName: groupForm.name, memberIds: groupForm.members });
      setGroupForm({ name: '', members: [] });
      fetchGroups();
      setStatusMessage('Group created');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to create group');
      console.error('Create group error:', error.response?.data || error.message);
    }
  };

  const addMembersToGroup = async () => {
    if (!addMemberForm.groupId || addMemberForm.members.length === 0) {
      alert('Please select members to add');
      return;
    }
    try {
      await api.post(`/api/groups/${addMemberForm.groupId}/members`, {
        memberIds: addMemberForm.members
      });
      setAddMemberForm({ groupId: null, members: [] });
      fetchGroups();
      setStatusMessage('Members added to group');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to add members');
      console.error('Add members error:', error.response?.data || error.message);
    }
  };

  const toggleAddMember = (memberId) => {
    setAddMemberForm((prev) => {
      const already = prev.members.includes(memberId);
      return {
        ...prev,
        members: already ? prev.members.filter((id) => id !== memberId) : [...prev.members, memberId]
      };
    });
  };

  const toggleGroupMember = (memberId) => {
    setGroupForm((prev) => {
      const already = prev.members.includes(memberId);
      return {
        ...prev,
        members: already ? prev.members.filter((id) => id !== memberId) : [...prev.members, memberId]
      };
    });
  };

  const authView = () => (
      <div className="auth-container">
        <div className="auth-card">
        <h1>GroupChat</h1>
        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            Login
          </button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
            Register
          </button>
          <button className={mode === 'forgot' ? 'active' : ''} onClick={() => setMode('forgot')}>
            Forgot
          </button>
        </div>

        {mode === 'login' && (
          <>
            <input
              placeholder="Username or Email"
              value={authForm.identifier}
              onChange={(e) => setAuthForm({ ...authForm, identifier: e.target.value })}
            />
            <div className="password-field">
              <input
                placeholder="Password"
                type={passwordVisibility.login ? 'text' : 'password'}
                value={authForm.password}
                onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() =>
                  setPasswordVisibility((prev) => ({ ...prev, login: !prev.login }))
                }
              >
                {passwordVisibility.login ? '🙈' : '👁️'}
              </button>
            </div>
            <button onClick={handleLogin} disabled={authLoading}>
              {authLoading ? (
                <>
                  <span className="spinner" />
                  Processing...
                </>
              ) : (
                'Login'
              )}
            </button>
          </>
        )}

        {mode === 'register' && (
          <>
            <input
              placeholder="Username"
              value={authForm.username}
              onChange={(e) => setAuthForm({ ...authForm, username: e.target.value })}
            />
            <input
              placeholder="Email"
              value={authForm.email}
              onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
            />
            <div className="password-field">
              <input
                placeholder="Password"
                type={passwordVisibility.register ? 'text' : 'password'}
                value={authForm.password}
                onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() =>
                  setPasswordVisibility((prev) => ({ ...prev, register: !prev.register }))
                }
              >
                {passwordVisibility.register ? '🙈' : '👁️'}
              </button>
            </div>
            <button onClick={handleRegister} disabled={authLoading}>
              {authLoading ? (
                <>
                  <span className="spinner" />
                  Creating...
                </>
              ) : (
                'Create account'
              )}
            </button>
          </>
        )}

        {mode === 'forgot' && (
          <>
            <input
              placeholder="Email"
              value={authForm.email}
              onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
            />
            <button onClick={handleForgotPassword}>Send OTP</button>
            {statusMessage && <p className="status">{statusMessage}</p>}
          </>
        )}

        {mode === 'otp' && (
          <>
            <input
              placeholder="Email"
              value={authForm.email}
              onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
            />
            <input
              placeholder="OTP Code"
              value={authForm.otp}
              onChange={(e) => setAuthForm({ ...authForm, otp: e.target.value })}
            />
            <input
              placeholder="New Password"
              type="password"
              value={authForm.newPassword}
              onChange={(e) => setAuthForm({ ...authForm, newPassword: e.target.value })}
            />
            <button onClick={handleVerifyOtp}>Verify OTP</button>
          </>
        )}
        {statusMessage && mode !== 'forgot' && <p className="status">{statusMessage}</p>}
        </div>
      </div>
    );

  if (!token || !user) {
    return authView();
  }

  const conversations = [
    ...friends.map((friend) => ({
      id: friend._id || friend.id,
      name: friend.username,
      type: 'direct',
      online: onlineUsers.some((online) => online.userId === (friend._id || friend.id)),
      lastSeen: friend.lastSeen
    })),
    ...groups.map((group) => ({
      id: group._id,
      name: group.groupName,
      type: 'group'
    }))
  ];

  const renderChatView = () => (
    <div className="chat-view">
      {!activeConversation ? (
        <div className="conversation-list-view">
          <div className="conversation-list-header">
          <h2>Chats</h2>
            <button className="create-group-btn" onClick={() => setActiveTab('friends')}>
              Create Group
            </button>
          </div>
          <ul className="conversation-list">
            {conversations.length === 0 ? (
              <li className="empty-state">
                <p>No conversations yet. Start chatting with friends!</p>
              </li>
            ) : (
              conversations.map((conversation) => (
                <li
                  key={`${conversation.type}-${conversation.id}`}
                  className={activeConversation?.id === conversation.id ? 'active' : ''}
                  onClick={() => selectConversation(conversation)}
                >
                  <div className="conversation-item">
                    <div>
                      <strong>{conversation.name}</strong>
                      {conversation.type === 'direct' && (
                        <span className={`status-dot ${conversation.online ? 'online' : 'offline'}`} />
                      )}
                    </div>
                    <small>{conversation.type === 'group' ? 'Group chat' : 'Direct message'}</small>
                  </div>
                </li>
              ))
            )}
            </ul>
          </div>
      ) : (
        <section className="chat-panel">
          {activeConversation ? (
            <>
              <header className="chat-header">
                <div className="chat-header-left">
                  <button className="back-btn" onClick={() => setActiveConversation(null)}>
                    ← Back
                  </button>
                  <div>
                    <h2>{activeConversation.name}</h2>
                    <p>{activeConversation.type === 'group' ? 'Group conversation' : 'Direct message'}</p>
                  </div>
                </div>
                {activeConversation.type === 'group' && (
                  <div className="group-actions">
                    <button
                      onClick={() =>
                        setAddMemberForm((prev) => ({
                          groupId: prev.groupId === activeConversation.id ? null : activeConversation.id,
                          members: []
                        }))
                      }
                    >
                      {addMemberForm.groupId === activeConversation.id ? 'Cancel' : 'Add Members'}
                    </button>
                  </div>
                )}
              </header>
              {activeConversation.type === 'group' && addMemberForm.groupId === activeConversation.id && (
                <div className="add-members-panel">
                  <h4>Add Members to Group</h4>
                  <div className="group-members">
                    {friends
                      .filter((friend) => {
                        const group = groups.find((g) => g._id === activeConversation.id);
                        if (!group || !group.members) return true;
                        const friendId = friend._id || friend.id;
                        return !group.members.some((m) => {
                          const memberId = typeof m === 'string' ? m : (m._id || m.id || m);
                          return memberId.toString() === friendId.toString();
                        });
                      })
                      .map((friend) => (
                        <label key={friend._id || friend.id}>
                          <input
                            type="checkbox"
                            checked={addMemberForm.members.includes(friend._id || friend.id)}
                            onChange={() => toggleAddMember(friend._id || friend.id)}
                          />
                          {friend.username}
                        </label>
                      ))}
                  </div>
                  {friends.filter((friend) => {
                    const group = groups.find((g) => g._id === activeConversation.id);
                    if (!group || !group.members) return true;
                    const friendId = friend._id || friend.id;
                    return !group.members.some((m) => {
                      const memberId = typeof m === 'string' ? m : (m._id || m.id || m);
                      return memberId.toString() === friendId.toString();
                    });
                  }).length === 0 && <p className="muted">All friends are already in this group</p>}
                  <button onClick={addMembersToGroup} disabled={addMemberForm.members.length === 0}>
                    Add Selected
                  </button>
                </div>
              )}

          <div className="chat-messages">
                {currentMessages.map((msg) => {
                  const mine = msg.senderId === (user.id || user._id);
              return (
                    <div key={msg.id} className={`message-row ${mine ? 'mine' : 'theirs'}`}>
                  <div className="message-bubble">
                        <div className="message-header">
                          <strong>{mine ? 'You' : msg.senderName}</strong>
                          <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <p>{msg.messageText}</p>
                        <div className="reaction-row">
                          {reactionEmojis.map((emoji) => (
                            <button key={emoji} onClick={() => reactToMessage(msg, emoji)}>
                              {emoji}
                            </button>
                          ))}
                        </div>
                        {msg.reactions?.length > 0 && (
                          <div className="reaction-list">
                            {msg.reactions.map((reaction) => (
                              <span key={`${reaction.userId}-${reaction.emoji}`}>
                                {reaction.emoji} {reaction.username === user.username ? 'You' : reaction.username}
                              </span>
                            ))}
                          </div>
                        )}
                  </div>
                </div>
              );
            })}
                {typingState && <div className="typing-indicator">Someone is typing…</div>}
          </div>

          <footer className="chat-input">
            <input
                  placeholder="Type a message…"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                    sendTypingSignal();
                    if (e.key === 'Enter') {
                      sendMessage();
                    }
              }}
            />
            <button onClick={sendMessage}>Send</button>
          </footer>
            </>
          ) : (
            <div className="empty-state">Select a friend or group to start chatting.</div>
          )}
        </section>
      )}
    </div>
  );

  const renderFriendsView = () => (
    <div className="friends-view">
      <div className="friends-header">
        <h2>Friends</h2>
      </div>

      <section className="friends-section">
        <h3>Search Users</h3>
        <div className="search-row">
          <input
            placeholder="Search by username or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button onClick={searchUsers}>Search</button>
        </div>
        {searchResults.length > 0 && (
          <ul className="search-results">
            {searchResults.map((result) => {
              const isAlreadyFriend = friends.some(
                friend => (friend._id || friend.id) === result._id
              );
              return (
                <li key={result._id}>
                  <div>
                    <strong>{result.username}</strong>
                    <small>{result.email}</small>
                  </div>
                  {!isAlreadyFriend ? (
                    <button onClick={() => sendFriendRequest(result._id)}>Add Friend</button>
                  ) : (
                    <span className="muted">Already friends</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="friends-section">
        <h3>Pending Friend Requests</h3>
        <ul className="requests">
          {friendRequests.length === 0 ? (
            <li className="empty-state">No pending requests</li>
          ) : (
            friendRequests.map((request) => (
              <li key={request._id}>
                <div>
                  <strong>{request.senderId.username}</strong>
                  <small>{request.senderId.email}</small>
                </div>
                <div className="request-actions">
                  <button onClick={() => respondToFriendRequest(request._id, 'accept')}>Accept</button>
                  <button onClick={() => respondToFriendRequest(request._id, 'decline')}>Decline</button>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="friends-section">
        <h3>My Friends ({friends.length})</h3>
        <ul className="friends-list">
          {friends.length === 0 ? (
            <li className="empty-state">No friends yet. Search for users to add them!</li>
          ) : (
            friends.map((friend) => {
              const isOnline = onlineUsers.some((online) => online.userId === (friend._id || friend.id));
              return (
                <li
                  key={friend._id || friend.id}
                  className="friend-item"
                  onClick={() => {
                    selectConversation({
                      id: friend._id || friend.id,
                      name: friend.username,
                      type: 'direct'
                    });
                    setActiveTab('chat');
                  }}
                >
                  <div>
                    <strong>{friend.username}</strong>
                    <small>{isOnline ? 'Online' : friend.lastSeen ? `Last seen: ${new Date(friend.lastSeen).toLocaleString()}` : 'Offline'}</small>
                  </div>
                  <span className={`status-dot ${isOnline ? 'online' : 'offline'}`} />
                </li>
              );
            })
          )}
        </ul>
      </section>

      <section className="friends-section">
        <h3>Create Group</h3>
        <input
          placeholder="Group name"
          value={groupForm.name}
          onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
        />
        <div className="group-members">
          {friends.length === 0 ? (
            <p className="muted">Add friends first to create a group</p>
          ) : (
            friends.map((friend) => (
              <label key={friend._id || friend.id}>
                <input
                  type="checkbox"
                  checked={groupForm.members.includes(friend._id || friend.id)}
                  onChange={() => toggleGroupMember(friend._id || friend.id)}
                />
                {friend.username}
              </label>
            ))
          )}
        </div>
        <button onClick={createGroup} disabled={!groupForm.name.trim() || groupForm.members.length === 0}>
          Create Group
        </button>
      </section>
    </div>
  );

  const renderSettingsView = () => (
    <div className="settings-view">
      <div className="settings-header">
        <h2>Settings</h2>
      </div>

      <section className="settings-section">
        <h3>Profile</h3>
        <div className="profile-info">
          <div>
            <strong>Username</strong>
            <p>{user.username}</p>
          </div>
          <div>
            <strong>Email</strong>
            <p>{user.email}</p>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h3>Account</h3>
        <button className="logout-btn" onClick={logout}>
          Logout
        </button>
      </section>

      <section className="settings-section">
        <h3>Statistics</h3>
        <div className="stats">
          <div className="stat-item">
            <strong>{friends.length}</strong>
            <span>Friends</span>
          </div>
          <div className="stat-item">
            <strong>{groups.length}</strong>
            <span>Groups</span>
          </div>
          <div className="stat-item">
            <strong>{conversations.length}</strong>
            <span>Conversations</span>
          </div>
        </div>
      </section>
    </div>
  );

  return (
    <div className="app-shell">
      <nav className="top-nav">
        <div className="nav-brand">
          <h1>GroupChat</h1>
        </div>
        <div className="nav-tabs">
          <button
            className={activeTab === 'chat' ? 'active' : ''}
            onClick={() => {
              setActiveTab('chat');
              setActiveConversation(null);
            }}
          >
            Chat
          </button>
          <button
            className={activeTab === 'friends' ? 'active' : ''}
            onClick={() => {
              setActiveTab('friends');
              setActiveConversation(null);
            }}
          >
            Friends
          </button>
          <button
            className={activeTab === 'settings' ? 'active' : ''}
            onClick={() => {
              setActiveTab('settings');
              setActiveConversation(null);
            }}
          >
            Settings
          </button>
        </div>
        <div className="nav-user">
          <span>{user.username}</span>
        </div>
      </nav>

      <main className="main-content">
        {activeTab === 'chat' && renderChatView()}
        {activeTab === 'friends' && renderFriendsView()}
        {activeTab === 'settings' && renderSettingsView()}
      </main>
    </div>
  );
}

export default App;
