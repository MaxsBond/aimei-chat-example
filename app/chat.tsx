"use client"
import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import * as chat from '@botpress/chat';
import type { AuthenticatedClient } from '@botpress/chat';
import { SignJWT } from 'jose';

// Define types for our messages display
type Message = {
  id: string;
  conversationId: string;
  userId: string;
  type: string;
  payload: any;
  direction: 'incoming' | 'outgoing';
  createdAt: string;
};

// TODO: Change this to the user ID from FF Dashboard
export const desiredUserId = "00000000-0000-0000-0000-000000000001";

export default function Chat() {
  const [client, setClient] = useState<AuthenticatedClient | null>(null);
  const [conversation, setConversation] = useState<{ id: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [waitingForResponse, setWaitingForResponse] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initRef = useRef(false);
  const listenerRef = useRef<any | null>(null);
  
  // webhook ID from Botpress Chat integration
  const webhookId = process.env.NEXT_PUBLIC_WEBHOOK_ID || "";
  
  // Initialize chat
  useEffect(() => {
    // Prevent double initialization
    if (initRef.current) return;
    
    const initializeChat = async () => {
      setDebugInfo(`Webhook ID: ${webhookId ? webhookId : 'Not set'}`);
      const encryptionKey = process.env.NEXT_PUBLIC_BOTPRESS_ENCRYPTION_KEY;
      
      if (!webhookId) {
        setError("Webhook ID is not configured in .env.local");
        setLoading(false);
        return;
      }
      
      try {
        initRef.current = true;
        setLoading(true);
        setError(null);
        
        let chatClient: AuthenticatedClient;

        if (encryptionKey) {
          setDebugInfo(prev => `${prev}\nEncryption key found. Value: '${encryptionKey}'. Generating JWT for user ${desiredUserId} for manual authentication.`);
          
          if (typeof encryptionKey !== 'string' || encryptionKey.trim() === '') {
            const keyErrorReason = typeof encryptionKey !== 'string' ? `Encryption key is not a string (found type: ${typeof encryptionKey})` : 'Encryption key is an empty string.';
            setDebugInfo(prev => `${prev}\nError: ${keyErrorReason}`);
            setError(`${keyErrorReason}. Please check NEXT_PUBLIC_BOTPRESS_ENCRYPTION_KEY.`);
            setLoading(false);
            initRef.current = false;
            return;
          }

          try {
            const secret = new TextEncoder().encode(encryptionKey);
            const userToken = await new SignJWT({ id: desiredUserId })
              .setProtectedHeader({ alg: 'HS256' })
              .setIssuedAt() // Optional: adds 'iat' claim
              // .setExpirationTime('2h') // Optional: adds 'exp' claim
              .sign(secret);
            
            setDebugInfo(prev => `${prev}\nJWT generated successfully using jose. Attempting to connect with userKey...`);
            
            chatClient = await chat.Client.connect({ 
                webhookId, 
                userId: desiredUserId, 
                userKey: userToken
            });
            setDebugInfo(prev => `${prev}\nConnected using manually generated JWT (as userKey) for user: ${chatClient.user.id}.`);
          } catch (jwtError: any) {
            setDebugInfo(prev => `${prev}\nError generating JWT with jose: ${jwtError.message}`);
            setError(`Failed to generate JWT for manual authentication with jose: ${jwtError.message}. Ensure encryption key is correct and valid for HS256.`);
            setLoading(false);
            initRef.current = false;
            return;
          }
        } else {
          setDebugInfo(prev => `${prev}\nWarning: Encryption key NOT FOUND in environment variables (NEXT_PUBLIC_BOTPRESS_ENCRYPTION_KEY). Cannot generate JWT. Attempting connection for user ${desiredUserId} without explicit manual authentication.`);
          chatClient = await chat.Client.connect({ 
              webhookId, 
              userId: desiredUserId 
          });
          setDebugInfo(prev => `${prev}\nConnected (fallback method) for user: ${chatClient.user.id}.`);
        }
        
        setClient(chatClient);
        
        // Create a conversation
        setDebugInfo(prev => `${prev}\nCreating conversation...`);
        const { conversation: conv } = await chatClient.createConversation({});
        setConversation(conv);
        setDebugInfo(prev => `${prev}\nConversation created successfully: ${JSON.stringify(conv)}`);
        
        // Set up the listener for incoming messages
        try {
          setDebugInfo(prev => `${prev}\nSetting up message listener...`);
          const listener = await chatClient.listenConversation({ id: conv.id });
          listenerRef.current = listener;
          
          listener.on('message_created', (event: any) => {
            setDebugInfo(prev => `${prev}\nMessage received: ${JSON.stringify(event)}`);
            // Only add bot messages (not our own messages)
            if (event.userId !== chatClient.user.id) {
              const newMessage: Message = {
                id: event.id,
                conversationId: event.conversationId,
                userId: event.userId,
                type: event.payload?.type || 'text',
                payload: event.payload,
                direction: 'incoming',
                createdAt: event.createdAt
              };
              setMessages(prev => [...prev, newMessage]);
              setWaitingForResponse(false); // Set waiting to false when response is received
            }
          });
          
          listener.on('error', (err: any) => {
            setDebugInfo(prev => `${prev}\nListener error: ${JSON.stringify(err)}`);
            console.error("SSE Error:", err);
          });
          
          setDebugInfo(prev => `${prev}\nListener set up successfully`);
        } catch (listenerError: any) {
          setDebugInfo(prev => `${prev}\nError setting up listener: ${listenerError.message}`);
          console.error("Error setting up listener:", listenerError);
          // Don't fail initialization for this
        }
        
        // Fetch initial messages
        try {
          setDebugInfo(prev => `${prev}\nFetching initial messages...`);
          const { messages: initialMessages } = await chatClient.listMessages({ 
            conversationId: conv.id 
          });
          
          // Convert to our message format
          const formattedMessages = initialMessages.map((msg: any) => ({
            id: msg.id,
            conversationId: msg.conversationId,
            userId: msg.userId,
            type: msg.payload?.type || 'text',
            payload: msg.payload,
            direction: msg.userId === chatClient.user.id ? 'outgoing' : 'incoming' as 'incoming' | 'outgoing',
            createdAt: msg.createdAt
          }));
          
          setMessages(formattedMessages);
          setDebugInfo(prev => `${prev}\nInitial messages fetched successfully`);
        } catch (fetchError: any) {
          setDebugInfo(prev => `${prev}\nError fetching messages: ${fetchError.message}`);
          console.error("Error fetching messages:", fetchError);
          // Don't fail initialization for this
        }
        
      } catch (error: any) {
        console.error("Error initializing chat:", error);
        setError(`Failed to initialize chat: ${error.message}. See console for details.`);
        initRef.current = false;
      } finally {
        setLoading(false);
      }
    };
    
    initializeChat();
  }, [webhookId]);
  
  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  // Clean up listener on unmount
  useEffect(() => {
    return () => {
      if (listenerRef.current) {
        listenerRef.current.close();
        setDebugInfo(prev => `${prev}\nListener closed`);
      }
    };
  }, []);
  
  const sendMessage = async () => {
    if (!input.trim() || !client || !conversation) {
      setDebugInfo(prev => `${prev}\nCannot send message: ${!input.trim() ? 'Empty input' : !client ? 'No client' : 'No conversation ID'}`);
      return;
    }
    
    const messageText = input.trim();
    setInput('');
    await sendMessageText(messageText);
  };
  
  // New function to send a specific message text
  const sendMessageText = async (messageText: string) => {
    if (!messageText || !client || !conversation) {
      return;
    }
    
    // Add message immediately to UI for better UX
    const tempMessage: Message = {
      id: Date.now().toString(),
      conversationId: conversation.id,
      userId: client.user.id,
      type: 'text',
      payload: { text: messageText, type: 'text' },
      direction: 'outgoing',
      createdAt: new Date().toISOString()
    };
    
    setMessages(prev => [...prev, tempMessage]);
    setWaitingForResponse(true); // Set waiting to true when sending message
    
    try {
      setDebugInfo(prev => `${prev}\nSending message: ${messageText}`);
      
      // Use the client to send the message
      await client.createMessage({
        conversationId: conversation.id,
        payload: {
          type: 'text',
          text: messageText
        }
      });
      
      setDebugInfo(prev => `${prev}\nMessage sent successfully`);
    } catch (error: any) {
      setDebugInfo(prev => `${prev}\nError sending message: ${error.message}`);
      console.error("Error sending message:", error);
      setError(`Failed to send message: ${error.message}. Please try again.`);
      setWaitingForResponse(false); // Set waiting to false if error
    }
  };
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  };
  
  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
  };
  
  const clearDebugInfo = () => {
    setDebugInfo('');
  };
  
  return (
    <div style={{
      width: '80vw',
      height: '80vh',
      display: 'flex',
      flexDirection: 'column',
      border: '1px solid #ccc',
      borderRadius: '8px',
      overflow: 'hidden'
    }}>
      {/* Chat header */}
      <div style={{
        padding: '15px',
        backgroundColor: '#000',
        color: 'white',
        fontWeight: 'bold',
        display: 'flex',
        justifyContent: 'space-between'
      }}>
        <div>Botpress Chat {webhookId ? '' : '(Missing Webhook ID)'}</div>
        <button
          onClick={clearDebugInfo}
          style={{
            backgroundColor: 'transparent',
            border: '1px solid white',
            color: 'white',
            padding: '2px 8px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          Clear Debug
        </button>
      </div>
      
      {/* Debug info */}
      {debugInfo && (
        <div style={{
          padding: '10px',
          backgroundColor: '#f8f8f8',
          borderBottom: '1px solid #ccc',
          fontSize: '12px',
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          maxHeight: '200px',
          overflowY: 'auto'
        }}>
          <strong>Debug Info:</strong>
          <br />
          {debugInfo}
        </div>
      )}
      
      {/* Messages container */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '15px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
      }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>Loading...</div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '20px', color: 'red' }}>{error}</div>
        ) : (
          <>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>
                Send a message to start the conversation
              </div>
            )}
            {messages.map((msg) => (
              <div 
                key={msg.id}
                style={{
                  alignSelf: msg.direction === 'incoming' ? 'flex-start' : 'flex-end',
                  backgroundColor: msg.direction === 'incoming' ? '#f0f0f0' : '#000',
                  color: msg.direction === 'incoming' ? '#000' : '#fff',
                  padding: '10px 15px',
                  borderRadius: '18px',
                  maxWidth: '70%',
                  wordBreak: 'break-word'
                }}
              >
                {msg.payload && msg.payload.text ? msg.payload.text : 'Unsupported message type'}
                
                {/* Render choice buttons if this is a choice message type with options */}
                {msg.type === 'choice' && msg.payload.options && (
                  <div style={{ 
                    marginTop: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}>
                    {msg.payload.options.map((option: { label: string, value: string }) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          // Send the option value directly
                          sendMessageText(option.value);
                        }}
                        style={{
                          background: '#fff',
                          border: '1px solid #ccc',
                          borderRadius: '12px',
                          padding: '8px 12px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          color: '#000',
                          fontWeight: 'normal',
                          fontSize: '14px'
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {waitingForResponse && (
              <div 
                style={{
                  alignSelf: 'flex-start',
                  backgroundColor: '#f0f0f0',
                  padding: '10px 15px',
                  borderRadius: '18px',
                  maxWidth: '70%',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                <div style={{ display: 'flex', gap: '4px' }}>
                  <span 
                    style={{
                      width: '6px',
                      height: '6px',
                      backgroundColor: '#666',
                      borderRadius: '50%',
                      opacity: '0.6',
                      animation: 'pulse 1.5s infinite',
                      display: 'inline-block'
                    }}
                  />
                  <span 
                    style={{
                      width: '6px',
                      height: '6px',
                      backgroundColor: '#666',
                      borderRadius: '50%',
                      opacity: '0.6',
                      animation: 'pulse 1.5s infinite 0.2s',
                      display: 'inline-block'
                    }}
                  />
                  <span 
                    style={{
                      width: '6px',
                      height: '6px',
                      backgroundColor: '#666',
                      borderRadius: '50%',
                      opacity: '0.6',
                      animation: 'pulse 1.5s infinite 0.4s',
                      display: 'inline-block'
                    }}
                  />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>
      
      {/* Input area */}
      <div style={{
        display: 'flex',
        padding: '15px',
        borderTop: '1px solid #ccc'
      }}>
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          onKeyPress={handleKeyPress}
          placeholder="Type a message..."
          style={{
            flex: 1,
            padding: '10px',
            borderRadius: '20px',
            border: '1px solid #ccc',
            marginRight: '10px'
          }}
          disabled={loading}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          style={{
            padding: '10px 15px',
            backgroundColor: '#000',
            color: 'white',
            border: 'none',
            borderRadius: '20px',
            cursor: loading || !input.trim() ? 'not-allowed' : 'pointer'
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
