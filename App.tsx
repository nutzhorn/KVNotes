import React, { useState, useEffect, useCallback, useRef } from 'react';
import { HashRouter, Routes, Route, useNavigate, useParams, Navigate, useLocation } from 'react-router-dom';
import { api } from './services/api';
import { secureStorage } from './services/secureStorage';
import { Collection, Note, User, ViewState } from './types';
import { IconPlus, IconFolder, IconTrash, IconEdit, IconLogOut, IconMenu, IconCheck, IconSearch, IconWifiOff, IconCloud, IconCloudOff, IconDevice, IconUpload, IconRefresh, IconSun, IconMoon, IconHome, IconMoreVertical, IconSettings } from './components/Icons';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { storage, PENDING_CHANGES_KEY } from './services/storage';

// --- Utils ---

const extractImages = (text: string): string[] => {
  if (!text) return [];
  const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
  const matches = text.match(urlRegex) || [];
  const imageExtensions = /\.(png|jpg|jpeg|webp|gif)($|\?)/i;
  return matches.filter(url => imageExtensions.test(url));
};

const removeImageUrls = (text: string): string => {
  if (!text) return '';
  const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
  const imageExtensions = /\.(png|jpg|jpeg|webp|gif)($|\?)/i;
  return text.replace(urlRegex, (url) => {
    return imageExtensions.test(url) ? '' : url;
  }).trim();
};

const sanitizeInput = (text: string): string => {
  if (!text) return '';
  // 1. Remove script tags and their content
  let clean = text.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "");
  // 2. Remove iframe, object, embed
  clean = clean.replace(/<(iframe|object|embed)\b[^>]*>([\s\S]*?)<\/\1>/gim, "");
  // 3. Remove event handlers (on*)
  clean = clean.replace(/ on\w+="[^"]*"/gim, "");
  // 4. Remove javascript: links
  clean = clean.replace(/href=["']javascript:[^"']*["']/gim, "");
  clean = clean.replace(/\[([^\]]*)\]\(javascript:[^)]*\)/gim, "$1"); // Markdown links
  return clean;
};

const parseInline = (text: string) => {
  // Split by ** (bold) then * (italic)
  // Note: This is a very basic parser.
  const parts = text.split(/(\*\*[^\*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-bold text-indigo-900 dark:text-indigo-300">{part.slice(2, -2)}</strong>;
    }
    const subParts = part.split(/(\*[^\*]+\*)/g);
    return subParts.map((sub, j) => {
      if (sub.startsWith('*') && sub.endsWith('*')) {
        return <em key={`${i}-${j}`} className="italic text-gray-800 dark:text-zinc-300">{sub.slice(1, -1)}</em>;
      }
      return sub;
    });
  });
};

const parseMarkdown = (text: string) => {
  if (!text) return null;
  const lines = text.split('\n');
  const blocks: any[] = [];
  let currentParagraph: string[] = [];

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const fullText = currentParagraph.join('\n');
      blocks.push(
        <div key={`p-${blocks.length}`} className="whitespace-pre-wrap min-h-[1.2em]">
          {parseInline(fullText)}
        </div>
      );
      currentParagraph = [];
    }
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      // List item breaks the paragraph
      flushParagraph();
      blocks.push(
        <div key={`param-${i}`} className="flex gap-2 ml-1">
          <span className="text-gray-400 dark:text-zinc-500">•</span>
          <span className="flex-1 whitespace-pre-wrap">{parseInline(trimmed.substring(2))}</span>
        </div>
      );
    } else {
      // Add to paragraph buffer (preserve original line including leading/trailing spaces if any, though standard markdown usually trims, we'll keep it simple)
      currentParagraph.push(line);
    }
  });

  // Flush remaining
  flushParagraph();

  return (
    <div className="space-y-1">
      {blocks}
    </div>
  );
};

// --- Components ---

const Button = ({ children, onClick, variant = 'primary', className = '', ...props }: any) => {
  const base = "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-10 px-4 py-2";
  const variants: any = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 shadow-md",
    secondary: "bg-white text-gray-900 border border-gray-200 hover:bg-gray-100 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-700",
    ghost: "hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-zinc-800 dark:text-zinc-300 dark:hover:text-zinc-100",
    danger: "bg-red-500 text-white hover:bg-red-600",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} onClick={onClick} {...props}>
      {children}
    </button>
  );
};

const Input = ({ className = '', ...props }: any) => (
  <input className={`flex h-10 w-full rounded-md border border-gray-300 bg-transparent px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:placeholder:text-zinc-500 dark:text-zinc-100 ${className}`} {...props} />
);

const Modal = ({ isOpen, onClose, title, children }: any) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-200 dark:border-zinc-800">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-zinc-800">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-zinc-100">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-500 dark:hover:text-zinc-300 transition-colors">
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>
        <div className="p-4">
          {children}
        </div>
      </div>
    </div>
  );
};

const OfflineModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="You are offline">
      <div className="flex flex-col items-center text-center space-y-4 pt-2">
        <div className="w-16 h-16 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center mb-1">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-red-500 dark:text-red-400">
            <path d="M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6M5 5a8 8 0 0 0 4 7h1.8a5 5 0 0 0-4 10H15" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        </div>
        <p className="text-gray-600 dark:text-zinc-400">
          You are currently offline. You cannot perform this action until you are online.
        </p>
        <Button onClick={onClose} className="w-full">
          Understood
        </Button>
      </div>
    </Modal>
  );
};

const PendingSyncManager = ({ pendingChanges, onSync, isSyncing, isOnline, onDiscard }: any) => {
  const [isOpen, setIsOpen] = useState(false);

  if (pendingChanges.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2 text-sm font-medium">
      {isOpen && (
        <div className="mb-2 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md rounded-xl shadow-2xl border border-gray-200/50 dark:border-white/10 w-80 overflow-hidden animate-in slide-in-from-bottom-5 fade-in duration-200">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5 flex items-center justify-between bg-gray-50/50 dark:bg-white/5">
            <h3 className="font-semibold text-gray-900 dark:text-zinc-100">Pending Changes</h3>
            <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors">
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div className="max-h-60 overflow-y-auto p-2 space-y-1">
            {pendingChanges.map((change: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-white/50 dark:bg-zinc-800/50 border border-gray-100 dark:border-white/5 hover:border-indigo-500/30 transition-colors">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-gray-700 dark:text-zinc-200">
                    {change.op === 'create' ? 'Create' : change.op === 'update' ? 'Edit' : 'Delete'} {change.type === 'note' ? 'Note' : 'Collection'}
                  </span>
                  <span className="text-[10px] text-gray-400 font-mono">
                    {new Date(change.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <Button variant="ghost" onClick={() => onDiscard(change)} className="h-6 px-2 text-[10px] uppercase font-bold tracking-wider text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                  Discard
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`group flex items-center gap-3 px-5 py-3 rounded-full shadow-xl transition-all border border-white/20 backdrop-blur-sm ${isOnline ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-amber-500/90 text-white hover:bg-amber-600'} ${isSyncing ? 'cursor-wait' : 'cursor-pointer hover:-translate-y-0.5'}`}
        disabled={isSyncing}
      >
        <div className={`relative ${isSyncing ? 'animate-spin' : ''}`}>
          <IconRefresh className="w-5 h-5" />
        </div>
        <div className="flex flex-col items-start leading-none gap-1">
          <span className="font-bold tracking-tight">
            {isOnline ? (isSyncing ? 'Syncing...' : 'Sync Changes') : 'Unsaved Changes'}
          </span>
          <span className="text-[10px] font-mono opacity-80">{pendingChanges.length} pending</span>
        </div>
        {isOnline && !isSyncing && (
          <div className="pl-3 border-l border-white/20 ml-1 opacity-60 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); onSync(); }}>
            <i className="fa-solid fa-cloud-arrow-up text-sm"></i>
          </div>
        )}
      </button>
    </div>
  );
};

const ImagePreview = ({ images, startIndex, onClose }: { images: string[], startIndex: number, onClose: () => void }) => {
  const [currentIndex, setCurrentIndex] = useState(startIndex);

  useEffect(() => {
    setCurrentIndex(startIndex);
  }, [startIndex]);

  const handleNext = (e?: any) => {
    e?.stopPropagation();
    setCurrentIndex((prev) => (prev + 1) % images.length);
  };

  const handlePrev = (e?: any) => {
    e?.stopPropagation();
    setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === 'ArrowLeft') handlePrev();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [images.length, onClose]);

  if (!images || images.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-md animate-in fade-in duration-200" onClick={onClose}>
      <button className="absolute top-4 right-4 text-white hover:text-gray-300 z-50" onClick={onClose}>
        <i className="fa-solid fa-xmark fa-2x"></i>
      </button>

      {images.length > 1 && (
        <>
          <button className="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 z-50 p-2" onClick={handlePrev}>
            <i className="fa-solid fa-chevron-left fa-2x"></i>
          </button>

          <button className="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 z-50 p-2" onClick={handleNext}>
            <i className="fa-solid fa-chevron-right fa-2x"></i>
          </button>

          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/80 bg-black/20 px-3 py-1 rounded-full text-sm font-medium backdrop-blur-sm">
            {currentIndex + 1} / {images.length}
          </div>
        </>
      )}

      <img
        src={images[currentIndex]}
        alt={`Preview ${currentIndex + 1}`}
        className="max-w-[95vw] max-h-[95vh] object-contain shadow-2xl rounded-sm animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
};

const ContextMenu = ({ x, y, options, onClose, align = 'left', direction = 'down' }: { x: number, y: number, options: { label?: string, content?: React.ReactNode, onClick?: () => void, className?: string }[], onClose: () => void, align?: 'left' | 'right', direction?: 'up' | 'down' }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-white dark:bg-zinc-800 rounded-lg shadow-xl border border-gray-100 dark:border-zinc-700 min-w-[200px] animate-in fade-in duration-100 overflow-hidden"
      style={{
        top: direction === 'down' ? y : 'auto',
        bottom: direction === 'up' ? (window.innerHeight - y) : 'auto',
        left: align === 'left' ? Math.min(x, window.innerWidth - 220) : 'auto',
        right: align === 'right' ? Math.max(8, window.innerWidth - x) : 'auto'
      }}
    >
      {options.map((opt, i) => (
        opt.content ? (
          <div key={i} className={opt.className}>
            {opt.content}
          </div>
        ) : (
          <button
            key={i}
            onClick={() => { if (opt.onClick) { opt.onClick(); onClose(); } }}
            className={`w-full text-left px-4 py-2 text-xs font-medium hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors ${opt.className || 'text-gray-700 dark:text-zinc-200'}`}
          >
            {opt.label}
          </button>
        )
      ))}
    </div>
  );
};

// --- Connection Form (Reusable) ---

const ConnectionForm = ({ onConnect, onCancel, showCancel = false, initialValues }: { onConnect: (u: User) => void, onCancel?: () => void, showCancel?: boolean, initialValues?: { apiUrl: string, apiToken: string } }) => {
  const [apiUrl, setApiUrl] = useState(initialValues?.apiUrl || '');
  const [apiToken, setApiToken] = useState(initialValues?.apiToken || '');
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setError(null);
    if (!apiUrl || !apiToken) {
      setError("Please provide both API URL and Token");
      return;
    }

    setIsConnecting(true);

    let cleanUrl = apiUrl.trim();
    if (!cleanUrl.startsWith('http')) {
      cleanUrl = `https://${cleanUrl}`;
    }
    cleanUrl = cleanUrl.replace(/\/$/, "");

    const id = crypto.randomUUID();

    const user: User = {
      id: id,
      username: 'API User',
      avatar: `https://ui-avatars.com/api/?name=User&background=6366f1&color=fff`,
      apiUrl: cleanUrl,
      apiToken
    };

    const previousUser = api.user;
    api.setUser(user);

    try {
      await api.validateConnection();
      try {
        const urlObj = new URL(cleanUrl);
        user.username = urlObj.hostname;
        user.avatar = `https://ui-avatars.com/api/?name=${urlObj.hostname.charAt(0)}&background=random&color=fff`;
      } catch (e) { }

      onConnect(user);
    } catch (e: any) {
      console.error(e);
      api.setUser(previousUser as any);

      let msg = "Connection failed. Please check your API URL, Token, and Server CORS configuration.";

      if (e.message?.includes("Failed to fetch")) {
        msg = "Network error. Please check your connection and CORS settings.";
      } else if (e.message?.includes("401")) {
        msg = "Authentication failed. Please check your token.";
      } else if (e.message?.includes("Configuration Error")) {
        // Clean up the JSON if possible, or just show the string
        msg = `Server Config Error: ${e.message.split('Configuration Error:')[1].replace(/["}]/g, '').trim()}`;
      } else if (e.message?.includes("HTTP error")) {
        msg = `Server Error: ${e.message}`;
      }

      setError(msg);
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="space-y-5">
      {error && (
        <div className="bg-red-50 text-red-700 text-sm p-3 rounded-md border border-red-200">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">API URL</label>
        <Input
          value={apiUrl}
          onChange={(e: any) => setApiUrl(e.target.value)}
          placeholder="https://kvnotes.user.workers.dev"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">API Token</label>
        <Input
          type="password"
          value={apiToken}
          onChange={(e: any) => setApiToken(e.target.value)}
          placeholder="Secret Token"
        />
      </div>

      <div className="flex gap-2">
        {showCancel && (
          <Button onClick={onCancel} variant="ghost" className="w-full" disabled={isConnecting}>
            Cancel
          </Button>
        )}
        <Button onClick={handleConnect} className="w-full h-11 text-base" disabled={isConnecting}>
          {isConnecting ? 'Connecting...' : 'Connect'}
        </Button>
      </div>
    </div>
  );
};

// --- Pages & Layouts ---

const LoginScreen = ({ onConnect, theme, setTheme }: { onConnect: (u: User) => void, theme: 'light' | 'dark', setTheme: (t: 'light' | 'dark') => void }) => {
  const handleDeviceLogin = () => {
    onConnect({
      id: 'device-local',
      username: 'Device User',
      avatar: 'https://ui-avatars.com/api/?name=Device&background=eab308&color=fff',
      apiUrl: '',
      apiToken: ''
    });
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 dark:bg-zinc-950 px-4 transition-colors">
      <button
        onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        className="absolute top-6 right-6 p-2 rounded-full bg-white dark:bg-zinc-800 shadow-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-amber-400 transition-colors"
      >
        {theme === 'light' ? <IconMoon className="w-5 h-5" /> : <IconSun className="w-5 h-5" />}
      </button>

      <div className="w-full max-w-md space-y-6 bg-white dark:bg-zinc-900 p-10 rounded-2xl shadow-xl border border-gray-100 dark:border-zinc-800">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-indigo-900 dark:text-indigo-400">KVNotes</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Offline-first notes.</p>
        </div>

        <div className="pt-2 space-y-4">
          <ConnectionForm onConnect={onConnect} />

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-gray-200 dark:border-zinc-800" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white dark:bg-zinc-900 px-2 text-gray-500 dark:text-zinc-500">Or</span>
            </div>
          </div>

          <Button variant="secondary" onClick={handleDeviceLogin} className="w-full h-11 text-base flex items-center justify-center gap-2 border-dashed border-2 dark:border-zinc-700">
            <IconDevice className="w-4 h-4 text-amber-500" />
            <span>Continue on Device Only</span>
          </Button>
        </div>

        <div className="text-center pt-2">
          <a href="https://github.com/nutzhorn/KVNotes/tree/worker" target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:text-indigo-600 hover:underline dark:text-indigo-400">
            No API yet? Run your own backend.
          </a>
        </div>
      </div>
    </div>
  );
};

const SmartRedirect = ({ collections, activeUser }: { collections: Collection[], activeUser: User | null }) => {
  const navigate = useNavigate();

  useEffect(() => {
    if (!activeUser || collections.length === 0) return;

    const lastId = secureStorage.getItem(`cloudnotes_last_col_${activeUser.id}`);
    const target = collections.find(c => c.id === lastId) || collections[0];

    if (target) {
      navigate(`/collection/${target.id}`, { replace: true });
    }
  }, [collections, activeUser, navigate]);

  if (collections.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 p-10">
        <div className="text-center">
          <IconFolder className="w-20 h-20 mx-auto mb-4 text-gray-200 dark:text-zinc-800" />
          <p>Create a collection to get started.</p>
        </div>
      </div>
    );
  }
  return null;
};

const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message, confirmLabel = 'Delete' }: any) => {
  if (!isOpen) return null;
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="space-y-4">
        <p className="text-gray-600 dark:text-zinc-300">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={onConfirm} className="bg-red-600 hover:bg-red-700 text-white shadow-sm">{confirmLabel}</Button>
        </div>
      </div>
    </Modal>
  );
};

// NoteEditorModal component removed as it was unused. Logic moved to CollectionView.

// --- Sidebar ---

// --- Sidebar ---
const Sidebar = ({ collections, activeId, onCreateCollection, onEditCollection, onDeleteCollection, activeUser, accounts, onSwitchAccount, onAddAccount, onEditAccount, onLogout, checkOnline, theme, setTheme, authError, lastSyncTime, offlineAccessUsers, setOfflineAccessUsers, onForceSyncAll }: any) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, id: string, type: 'collection' | 'account' | 'settings', align?: 'left' | 'right', direction?: 'up' | 'down' } | null>(null);
  const [showClearDataConfirm, setShowClearDataConfirm] = useState(false);
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const location = useLocation();

  const handleNav = (id: string) => {
    if (activeUser) secureStorage.setItem(`cloudnotes_last_col_${activeUser.id}`, id);
    navigate(`/collection/${id}`);
    setIsMobileMenuOpen(false);
  };

  const handleContextMenu = (e: React.MouseEvent, id: string, type: 'collection' | 'account' | 'settings', align: 'left' | 'right' = 'left', direction: 'up' | 'down' = 'down') => {
    e.preventDefault();
    e.stopPropagation();

    // Toggle Logic: Close if clicking the same active menu trigger
    if (contextMenu?.id === id && contextMenu?.type === type) {
      setContextMenu(null);
      return;
    }

    if (align === 'right') {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      if (direction === 'up') {
        setContextMenu({ x: rect.right, y: rect.top - 5, id, type, align: 'right', direction: 'up' });
      } else {
        setContextMenu({ x: rect.right, y: rect.bottom + 5, id, type, align: 'right', direction: 'down' });
      }
    } else {
      setContextMenu({ x: e.clientX, y: e.clientY, id, type, align: 'left', direction });
    }
  };

  const handleClearData = () => {
    setShowClearDataConfirm(true);
  };

  const performClearData = () => {
    if (activeUser) {
      storage.clearUserData(activeUser.id);
      window.location.reload();
    }
  };

  const handleCreateCollection = () => {
    onCreateCollection();
  };

  const handleDeleteCollection = (id: string) => {
    onDeleteCollection(id);
  };

  const handleEditCollection = (id: string) => {
    onEditCollection(id);
  };

  const handleAddAccount = () => {
    if (checkOnline() && onAddAccount) {
      onAddAccount();
    }
  };

  return (
    <>
      {/* Mobile Toggle */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-white dark:bg-zinc-900 border-b dark:border-zinc-800 z-30 flex items-center px-4 justify-between">
        <span className="font-bold text-lg text-indigo-900 dark:text-indigo-400">KVNotes</span>
        <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
          <IconMenu className="w-6 h-6 text-gray-700 dark:text-zinc-400" />
        </button>
      </div>

      <div className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-zinc-900 text-zinc-300 transform transition-transform duration-200 ease-in-out flex flex-col
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        md:relative md:translate-x-0
      `}>
        <div className="h-auto py-4 flex flex-col px-6 border-b border-zinc-800">
          <div className="flex items-center justify-between">
            <h1 className="font-bold text-xl text-white tracking-wider">KVNotes</h1>
          </div>

          <div className="mt-2 flex items-center gap-2 text-xs">
            {activeUser && activeUser.id !== 'device-local' && (isOnline ? (
              <>
                <IconCloud className="text-green-500" />
                <span className="text-zinc-500">Online</span>
              </>
            ) : (
              <>
                <IconCloudOff className="text-red-500" />
                <span className="text-zinc-500">Offline Mode</span>
              </>
            ))}
          </div>
        </div>

        <div className="p-4 flex-1 overflow-y-auto">
          <div className="mb-6">
            <button
              onClick={() => { if (activeUser) navigate('/'); setIsMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all ${location.pathname === '/' ? 'bg-zinc-800 text-white' : 'hover:bg-zinc-800 text-zinc-400 hover:text-white'}`}
            >
              <IconHome className="w-4 h-4 mt-[2px]" />
              <span className="font-medium">Home</span>
            </button>
          </div>

          <div className="flex items-center justify-between mb-2 px-2">
            <span className="text-xs font-semibold uppercase text-zinc-500 tracking-wider">Collections</span>
            <button onClick={handleCreateCollection} className="text-zinc-400 hover:text-white transition-colors">
              <IconPlus className="w-4 h-4" />
            </button>
          </div>

          <nav className="space-y-1">
            {collections.map((col: Collection) => (
              <button
                key={col.id}
                onClick={() => handleNav(col.id)}
                onContextMenu={(e) => handleContextMenu(e, col.id, 'collection')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all ${activeId === col.id
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/50'
                  : 'hover:bg-zinc-800 hover:text-white'
                  }`}
              >
                <IconFolder className={`w-4 h-4 ${activeId === col.id ? 'text-indigo-200' : 'text-zinc-500'}`} />
                <span className="truncate flex-1 text-left leading-tight">{col.name}</span>
                {col.isLocal && <IconDevice className="text-xs text-yellow-500" />}
              </button>
            ))}
            {collections.length === 0 && (
              <div className="text-sm text-zinc-600 px-3 py-4 italic">No collections yet.</div>
            )}
          </nav>
        </div>

        <div className="p-4 border-t border-zinc-800 bg-zinc-900/50">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Accounts</div>
          <div className="space-y-1 mb-2 max-h-32 overflow-y-auto custom-scrollbar">
            {accounts.map((acc: User) => (
              <button
                key={acc.id}
                onClick={() => onSwitchAccount(acc.id)}
                onContextMenu={(e) => handleContextMenu(e, acc.id, 'account')}
                className={`w-full flex items-center gap-2 p-2 rounded-md text-sm transition-colors ${activeUser.id === acc.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'}`}
              >
                <div className="w-5 h-5 rounded-full overflow-hidden flex-shrink-0 bg-zinc-700">
                  <img src={acc.avatar} className="w-full h-full object-cover" alt="" />
                </div>
                <span className="truncate flex-1 text-left">{acc.username}</span>
                {activeUser.id === acc.id && <IconCheck className="w-4 h-4 text-indigo-400" />}
              </button>
            ))}
          </div>

          <button
            onClick={handleAddAccount}
            className="w-full flex items-center gap-2 px-2 py-2 text-xs text-zinc-400 hover:text-white transition-colors rounded-md hover:bg-zinc-800"
          >
            <IconPlus className="w-3 h-3" />
            <span>Add Account</span>
          </button>



          <div className="h-px bg-zinc-800 my-2" />

          <div className="flex items-center gap-2">
            {activeUser && (
              <button
                onClick={() => onLogout && onLogout(activeUser.id)}
                className="flex-1 flex items-center gap-3 px-3 py-2 text-zinc-400 hover:text-red-400 transition-colors rounded-md hover:bg-zinc-800"
              >
                <IconLogOut className="w-4 h-4" />
                <span className="text-xs font-medium">Log Out</span>
              </button>
            )}
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => handleContextMenu(e, 'settings', 'settings', 'right', 'up')}
              className={`p-2 transition-colors rounded-md ${contextMenu?.type === 'settings' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white hover:bg-zinc-800'}`}
              title="Settings"
            >
              <IconSettings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {contextMenu && contextMenu.type === 'collection' && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          align={contextMenu.align}
          onClose={() => setContextMenu(null)}
          options={[
            { label: 'Edit', onClick: () => handleEditCollection(contextMenu.id) },
            { label: 'Delete', onClick: () => handleDeleteCollection(contextMenu.id), className: 'text-red-600 font-medium' }
          ]}
        />
      )}

      {contextMenu && contextMenu.type === 'account' && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          align={contextMenu.align}
          onClose={() => setContextMenu(null)}
          options={[
            { label: 'Edit', onClick: () => onEditAccount(contextMenu.id) },
            { label: 'Log Out', onClick: () => onLogout(contextMenu.id), className: 'text-red-600 font-medium' }
          ].filter(opt => opt.label !== 'Edit' || contextMenu.id !== 'device-local')}
        />
      )}

      {contextMenu && contextMenu.type === 'settings' && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          align={contextMenu.align}
          direction={contextMenu.direction}
          onClose={() => setContextMenu(null)}
          options={[
            {
              content: (
                <div className="bg-gray-100 dark:bg-zinc-700/50 p-1 flex gap-1 rounded-lg">
                  <button
                    onClick={() => setTheme('light')}
                    className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-xs font-medium transition-all ${theme !== 'dark' ? 'bg-white shadow-sm text-gray-900 font-bold' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-zinc-200'}`}
                  >
                    <IconSun className="w-3.5 h-3.5" /> Light
                  </button>
                  <button
                    onClick={() => setTheme('dark')}
                    className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-xs font-medium transition-all ${theme === 'dark' ? 'bg-zinc-600 shadow-sm text-white font-bold' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-zinc-200'}`}
                  >
                    <IconMoon className="w-3.5 h-3.5" /> Dark
                  </button>
                </div>
              ),
              className: "w-full p-1"
            },
            ...(activeUser?.id === 'device-local' ? [{
              content: (
                <div className="px-2 py-2">
                  <button onClick={() => { handleClearData(); setContextMenu(null); }} className="w-full py-2 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors text-center">
                    Clear Local Data
                  </button>
                </div>
              ),
              className: "w-full p-0"
            }] : []),
            // Offline Access (Checkmark Style)
            ...(activeUser && activeUser.id !== 'device-local' ? [{
              content: (
                <button
                  onClick={() => {
                    const isEnabled = offlineAccessUsers.has(activeUser.id);
                    const next = new Set(offlineAccessUsers);
                    if (isEnabled) {
                      next.delete(activeUser.id);
                      storage.clearSyncedData(activeUser.id);
                    } else {
                      next.add(activeUser.id);
                      // Trigger immediate background sync for this user
                      setTimeout(async () => {
                        try {
                          if (!isOnline) return;
                          const cols = await api.getCollections(activeUser);
                          storage.saveSyncedCollections(cols, activeUser.id);
                          for (const col of cols) {
                            const notes = await api.getNotes(col.id, activeUser);
                            storage.saveSyncedNotes(col.id, notes);
                          }
                          const now = Date.now();
                          setLastSyncTime(now);
                          secureStorage.setItem('cloudnotes_global_last_sync', String(now));
                          secureStorage.setItem(`cloudnotes_last_bg_sync_${activeUser.id}`, String(now));
                        } catch (e) { }
                      }, 0);
                    }
                    setOfflineAccessUsers(next);
                  }}
                  className="w-full flex items-center justify-between px-2 py-2 text-xs font-medium text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-700 rounded-md transition-colors"
                >
                  <span>Offline Access</span>
                  {offlineAccessUsers.has(activeUser.id) ? (
                    <IconCheck className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border border-gray-300 dark:border-zinc-600" />
                  )}
                </button>
              ),
              className: "w-full p-1 border-t border-gray-100 dark:border-zinc-700 mt-1"
            }] : []),
            ...(!accounts.find((a: User) => a.id === 'device-local') ? [{
              content: (
                <button
                  onClick={() => {
                    onAddAccount({
                      id: 'device-local',
                      username: 'Device User',
                      avatar: 'https://ui-avatars.com/api/?name=Device&background=eab308&color=fff'
                    });
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center justify-between px-2 py-2 text-xs font-medium text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-700 rounded-md transition-colors"
                >
                  <span>Enable Device Account</span>
                  <div className="w-3.5 h-3.5 rounded-full border border-gray-300 dark:border-zinc-600" />
                </button>
              ),
              className: "w-full p-1"
            }] : []),
            // Footer: Last Synced + Force Reload
            // Show footer even if not enabled for current user? Maybe only if enabled.
            // Requirement says "Force Sync only targets enabled accounts". Button executes force sync for ALL enabled.
            ...(activeUser?.id && offlineAccessUsers.has(activeUser.id) ? [{
              content: (
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-zinc-800/50 border-t border-gray-100 dark:border-zinc-700 rounded-b-lg">
                  <span className="text-[10px] text-gray-400 dark:text-zinc-500">
                    Last Synced: {lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never'}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onForceSyncAll(); }}
                    className="p-1 text-gray-400 hover:text-indigo-600 dark:text-zinc-500 dark:hover:text-indigo-400 transition-colors"
                    title="Force Sync Enabled Accounts"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                      <path d="M21 12a9 9 0 0 0-9-9 9.75 9 0 0 0-6.74 2.74L3 8" />
                      <path d="M3 3v5h5" />
                      <path d="M3 12a9 9 0 0 0 9 9 9.75 9 0 0 0 6.74-2.74L21 16" />
                      <path d="M16 21h5v-5" />
                    </svg>
                  </button>
                </div>
              ),
              className: "w-full p-0"
            }] : [])
          ]}
        />
      )}

      <ConfirmationModal
        isOpen={showClearDataConfirm}
        onClose={() => setShowClearDataConfirm(false)}
        onConfirm={performClearData}
        title="Clear Account Data"
        message="Are you sure? This will delete all your local notes and collections. This action cannot be undone."
        confirmLabel="Clear Data"
      />

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
    </>
  );
};

// --- Note List View ---

const NoteCard = ({ note, onClick, onDelete, onContextMenu, onImageClick }: any) => {
  if (!note) return null;
  const images = extractImages(note.text);
  const displayText = removeImageUrls(note.text);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [isExpanded, setIsExpanded] = useState(false);
  // Lowered threshold to 150 chars to matches visual truncation better
  const isLong = displayText.length > 200 || displayText.split('\n').length > 5;

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = direction === 'left' ? -120 : 120;
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`group bg-white dark:bg-zinc-800 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-700 p-5 hover:shadow-md dark:hover:bg-zinc-700 transition-all cursor-pointer relative flex flex-col ${isExpanded ? 'row-span-2 h-auto' : 'h-60'} animate-in fade-in zoom-in-95 duration-300`}
    >
      <div className={`flex-1 relative ${!isExpanded ? 'overflow-hidden' : ''}`}>
        <div className="text-gray-800 dark:text-zinc-200 text-sm leading-relaxed">
          {displayText ? parseMarkdown(displayText) : <span className="text-gray-300 dark:text-zinc-600 italic">Empty note</span>}
        </div>

        {isLong && !isExpanded && (
          <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white via-white/90 to-transparent dark:from-zinc-800 dark:via-zinc-800/90 dark:to-transparent group-hover:dark:from-zinc-700 group-hover:dark:via-zinc-700/90 pointer-events-none z-10 transition-colors duration-300"></div>
        )}
      </div>

      {isLong && (
        <div className="absolute top-2 right-2 z-30 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
            className="p-1.5 bg-white/90 dark:bg-zinc-700/90 hover:bg-white dark:hover:bg-zinc-600 rounded-md shadow-sm border border-gray-200 dark:border-zinc-600 text-gray-500 dark:text-zinc-300 transition-colors"
            title={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? <i className="fa-solid fa-compress text-xs"></i> : <i className="fa-solid fa-expand text-xs"></i>}
          </button>
        </div>
      )}

      <div className="mt-3 border-t border-gray-100 dark:border-white/5 pt-3 space-y-3">
        {images.length > 0 && (
          <div className="relative group/carousel">
            {images.length > 6 && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); scroll('left'); }}
                  className="absolute -left-3 top-1/2 -translate-y-1/2 z-10 bg-white/90 shadow-md border border-gray-100 rounded-full p-1 opacity-0 group-hover/carousel:opacity-100 transition-opacity hover:bg-white"
                >
                  <i className="fa-solid fa-chevron-left text-gray-600 text-xs"></i>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); scroll('right'); }}
                  className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 bg-white/90 shadow-md border border-gray-100 rounded-full p-1 opacity-0 group-hover/carousel:opacity-100 transition-opacity hover:bg-white"
                >
                  <i className="fa-solid fa-chevron-right text-gray-600 text-xs"></i>
                </button>
              </>
            )}
            <div
              ref={scrollRef}
              className="flex gap-1.5 overflow-x-auto scroll-smooth items-center [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {images.map((img, i) => (
                <div
                  key={i}
                  onClick={(e) => { e.stopPropagation(); onImageClick(i, images); }}
                  className="flex-shrink-0 h-10 w-10 rounded-md overflow-hidden border border-gray-200 bg-gray-50 relative cursor-zoom-in hover:opacity-80 transition-opacity"
                >
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-gray-400">
          <div className="flex items-center gap-2">
            <span>{note.created ? new Date(note.created).toLocaleDateString() : 'Unknown date'}</span>
            {note.isLocal && <IconDevice className="w-3 h-3 text-yellow-500" />}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-50 hover:text-red-500 rounded-md transition-all"
          >
            <IconTrash className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

const CollectionView = ({ collections, refreshCollections, checkOnline, isOnline, pendingChangesVersion, activeUser, onDeleteCollection }: any) => {
  const { id } = useParams();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentCollection, setCurrentCollection] = useState<Collection | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ id: string } | null>(null);

  // Modal States
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [noteText, setNoteText] = useState('');
  const [saveType, setSaveType] = useState<'cloud' | 'local'>('cloud');

  // Preview State
  const [previewData, setPreviewData] = useState<{ images: string[], index: number } | null>(null);

  // Ghost Filter: Track deleted IDs locally to ignore them if API returns them (Eventual Consistency)
  const ghostDeletedIds = useRef(new Set<string>());

  // Context Menu
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, id: string } | null>(null);

  const navigate = useNavigate();
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const insertFormat = (format: 'bold' | 'italic' | 'list') => {
    const textarea = textAreaRef.current;
    if (!textarea) return;

    textarea.focus();
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end);

    let replacement = '';

    // Helper to process lines for formatting
    const processLines = (
      input: string,
      token: string,
      process: (content: string, hasToken: boolean) => string
    ) => {
      const lines = input.split('\n');
      // Check if we should remove or add based on ALL lines having the format
      // Note: For mixed list/non-list, we just look at the content part
      const areAllFormatted = lines.every(line => {
        const content = line.trimStart().startsWith('- ') ? line.trimStart().substring(2) : line;
        if (!content.trim()) return true; // Ignore empty lines in check
        return content.trim().startsWith(token) && content.trim().endsWith(token);
      });

      return lines.map(line => {
        // preserve indentation? Standard impl assumes no indentation for now based on previous code.
        // We'll handle standard "- " prefix.
        const trimmed = line.trimStart(); // Actually we usually only stick to "- " at start for this app
        const isList = trimmed.startsWith('- ');
        const prefix = isList ? "- " : "";
        const content = isList ? trimmed.substring(2) : line;

        if (!content.trim()) return line; // Skip empty content

        return prefix + process(content, areAllFormatted);
      }).join('\n');
    };

    if (format === 'bold') {
      replacement = processLines(selected, '**', (content, remove) => {
        if (remove) {
          // Naive remove: replace first/last instances. 
          // Better: regex replace? or simple substring if we are sure.
          // We checked startsWith/endsWith in the check.
          if (content.trim().startsWith('**') && content.trim().endsWith('**')) {
            return content.replace(/^\*\*/, '').replace(/\*\*$/, '');
          }
          return content;
        }
        return `**${content}**`;
      });
      // Fallback for single line intra-word selection that shouldn't be treated as line-block?
      // If no newlines and no list prefix, maybe standard toggle is safer?
      if (!selected.includes('\n') && !selected.trim().startsWith('- ')) {
        // Keep original simple toggle for " wor " in "world"
        const isRefBold = (selected.startsWith('**') && selected.endsWith('**')) ||
          (text.substring(start - 2, start) === '**' && text.substring(end, end + 2) === '**');
        if (isRefBold) {
          if (selected.startsWith('**')) replacement = selected.substring(2, selected.length - 2);
          else {
            // Expands selection to remove surrounding
            textarea.setSelectionRange(start - 2, end + 2);
            replacement = selected;
          }
        } else {
          replacement = `**${selected}**`;
        }
      }
    } else if (format === 'italic') {
      replacement = processLines(selected, '*', (content, remove) => {
        if (remove) {
          if (content.trim().startsWith('*') && content.trim().endsWith('*') && !content.trim().startsWith('**')) {
            return content.replace(/^\*/, '').replace(/\*$/, '');
          }
          return content;
        }
        return `*${content}*`;
      });
      // Fallback for single line intra-word
      if (!selected.includes('\n') && !selected.trim().startsWith('- ')) {
        const isRefItalic = (selected.startsWith('*') && selected.endsWith('*')) ||
          (text.substring(start - 1, start) === '*' && text.substring(end, end + 1) === '*');
        if (isRefItalic) {
          if (selected.startsWith('*')) replacement = selected.substring(1, selected.length - 1);
          else {
            textarea.setSelectionRange(start - 1, end + 1);
            replacement = selected;
          }
        } else {
          replacement = `*${selected}*`;
        }
      }
    } else if (format === 'list') {
      const before = text.substring(0, start);
      const after = text.substring(end);
      const lastNewLine = before.lastIndexOf('\n');
      const lineStart = lastNewLine === -1 ? 0 : lastNewLine + 1;

      const nextNewLine = after.indexOf('\n');
      const lineEnd = nextNewLine === -1 ? text.length : end + nextNewLine;

      const fullContent = text.substring(lineStart, lineEnd);
      const lines = fullContent.split('\n');

      const capitalizedLines = lines.filter(l => /^[A-Z]/.test(l.replace(/^- /, '')));
      // If we have capitalized lines, we only toggle THEM. 
      // If NO capitalized lines, we toggle EVERYTHING (standard behavior fallback).
      const targetLines = capitalizedLines.length > 0 ? capitalizedLines : lines;

      const allTargetsAreLists = targetLines.length > 0 && targetLines.every(l => l.startsWith('- '));

      const newLines = lines.map(line => {
        const content = line.replace(/^- /, '');
        const isCap = /^[A-Z]/.test(content);

        // If we are targeting casual lines (capitalized), skip non-caps
        if (capitalizedLines.length > 0 && !isCap) return line;

        if (allTargetsAreLists) {
          return content;
        } else {
          return `- ${content}`;
        }
      });

      replacement = newLines.join('\n');
      textarea.setSelectionRange(lineStart, lineEnd);
    }

    document.execCommand('insertText', false, replacement);
  };

  const loadNotes = useCallback(async () => {

    // 1. Immediate Cache Load (Stale-while-revalidate)
    const localNotes = storage.getLocalNotes(id);
    const cachedNotes = storage.getCachedNotes(id);

    // Helper to merge and filter
    const mergeAndSort = (base: Note[], override: Note[]) => {
      const noteMap = new Map<string, Note>();
      base.forEach(n => noteMap.set(n.id, n));
      override.forEach(n => noteMap.set(n.id, n));

      const pending = activeUser ? storage.getPendingChanges(activeUser.id) : [];
      const pendingDeletedIds = new Set(pending.filter(p => p.type === 'note' && p.op === 'delete').map(p => p.id));

      const combined = Array.from(noteMap.values()).filter(n =>
        n &&
        !pendingDeletedIds.has(n.id) &&
        !ghostDeletedIds.current.has(n.id) &&
        !storage.isDeleted(n.id)
      );
      combined.sort((a, b) => b.created - a.created);
      return combined;
    };

    const initialCombined = mergeAndSort(cachedNotes, localNotes);
    setNotes(initialCombined);

    // Only show loading if we have absolutely nothing to show
    if (initialCombined.length === 0) {
      setLoading(true);
    }

    try {
      if (isOnline) {
        // Fix: Ensure API has user (direct reload race condition)
        if (activeUser) api.setUser(activeUser);

        console.log(`[loadNotes] Fetching from API for ${id}...`);
        const fetched = await api.getNotes(id);
        console.log(`[loadNotes] Fetched ${fetched.length} notes.`);

        if (activeUser) {
          storage.saveSyncedNotes(id, fetched);

          // CLEANUP: Remove local ghosts if they exist on server
          const currentPending = storage.getPendingChanges(activeUser.id);
          const currentLocalNotes = storage.getLocalNotes(id);

          fetched.forEach(remote => {
            if (currentLocalNotes.some(l => l.id === remote.id)) {
              const hasPending = currentPending.some(p => p.id === remote.id && p.type === 'note');
              if (!hasPending) {
                console.log(`[loadNotes] Reconciled note ${remote.id}. Removing local ghost.`);
                storage.deleteLocalNote(id, remote.id, activeUser.id);
              }
            }
          });
        }

        // Re-merge with potentially updated local notes (in case edits happened during fetch)
        const currentLocal = storage.getLocalNotes(id);
        setNotes(mergeAndSort(fetched, currentLocal));
      }
    } catch (e) {
      console.warn("Failed to fetch cloud notes", e);
      // We already showed cache, so just stay there.
    } finally {
      setLoading(false);
    }
  }, [id, pendingChangesVersion, activeUser, isOnline]);

  // Effect 1: Update Current Collection (Does NOT trigger loadNotes)
  useEffect(() => {
    const col = collections.find((c: Collection) => c.id === id);
    setCurrentCollection(col);
  }, [id, collections]);

  // Effect 2: Load Notes (Only when ID changes or we need refresh)
  useEffect(() => {
    console.log(`[CollectionView] ID Changed or Refresh. Loading notes...`);
    if (id) {
      loadNotes();
    }
    setSearchQuery('');
  }, [id, loadNotes, pendingChangesVersion]); // Collections removed from dependency!

  useEffect(() => {
    if (editingNote) {
      setSaveType(editingNote.isLocal || activeUser?.id === 'device-local' ? 'local' : 'cloud');
    }
  }, [editingNote, activeUser]);


  const filteredNotes = notes.filter(n =>
    n.text.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSaveNote = async () => {
    if (!id || !activeUser) return;

    // Sanitize Input (Security Hardening)
    // We do NOT modify the editor state (setNoteText) to avoid jarring cursor jumps or UX.
    // We only sanitize the payload sent to storage/API.
    const sanitizedText = sanitizeInput(noteText);
    // if (!checkOnline()) return; // REMOVED: We allow offline saving now

    const tempId = editingNote ? editingNote.id : crypto.randomUUID();
    const now = Date.now();

    // Determine effective save type
    let effectiveSaveType = saveType;
    // We no longer switch to 'local' automatically when offline.
    // If user wants 'cloud' but is offline, we queue it.

    // However, if the collection itself is local, notes MUST be local.
    if (currentCollection && currentCollection.isLocal) {
      effectiveSaveType = 'local';
    }

    // Auto-Resolve Logic: Check if we are reverting to original state
    if (activeUser && editingNote && !currentCollection?.isLocal) {
      const cachedNotes = storage.getCachedNotes(id);
      const original = cachedNotes.find(n => n.id === editingNote.id);

      // If text matches original, this is an undo!
      if (original && original.text === noteText) {
        console.log("[Auto-Resolve] Edit matches original. Reverting pending change.");

        storage.removePendingChange(editingNote.id, 'note', 'update', activeUser.id);
        storage.deleteLocalNote(id, editingNote.id, activeUser.id); // Fallback to cache

        setIsNoteModalOpen(false);
        loadNotes();
        refreshCollections();
        return;
      }
    }

    const optimisticNote: Note = {
      id: tempId,
      collectionId: id,
      text: sanitizedText,
      created: editingNote ? editingNote.created : now,
      isLocal: effectiveSaveType === 'local'
    };

    // UI Update
    setNotes(prev => {
      const existing = prev.findIndex(n => n.id === tempId);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = optimisticNote;
        return next;
      }
      return [optimisticNote, ...prev];
    });

    setIsNoteModalOpen(false);

    try {
      if (effectiveSaveType === 'local') {
        storage.saveLocalNote(optimisticNote, activeUser.id);
        // If it was cloud before, we need to delete it from cloud
        if (editingNote && !editingNote.isLocal) {
          if (isOnline) {
            try {
              await api.deleteNote(id, editingNote.id);
            } catch (e) { console.warn("Failed to delete cloud note after moving to local", e); }
          } else {
            // Queue deletion
            // Queue deletion
            storage.queueChange({ type: 'note', op: 'delete', id: editingNote.id, collectionId: id, timestamp: Date.now() }, activeUser.id);
            refreshCollections();
          }
        }
      } else {
        // Cloud Save Scope
        // 1. Optimistic Local Save (Always)
        // This ensures it appears immediately in loadNotes (via merge) and persists through reloads
        storage.saveLocalNote({ ...optimisticNote, isLocal: false }, activeUser.id);

        // 2. Queue Change (Resilience)
        // We queue it so if the immediate API call fails or we go offline, the background sync picks it up.
        // If API succeeds, we remove it from queue.
        storage.queueChange({
          type: 'note',
          op: editingNote && !editingNote.isLocal ? 'update' : 'create',
          id: tempId,
          collectionId: id,
          data: { text: sanitizedText },
          timestamp: now
        }, activeUser.id);

        // Only refresh UI immediately if offline. If online, we wait for success/fail to avoid popup flicker.
        if (!isOnline) {
          refreshCollections();
        }

        if (isOnline) {
          // 3. Background Sync
          (async () => {
            try {
              if (editingNote && !editingNote.isLocal) {
                await api.updateNote(id, editingNote.id, sanitizedText);
              } else {
                // CREATE
                await api.createNote(id, sanitizedText, tempId);

                if (editingNote && editingNote.isLocal) {
                  storage.deleteLocalNote(id, editingNote.id, activeUser.id);
                }
              }
              // Success: Remove from queue
              storage.removePendingChange(tempId, 'note', editingNote && !editingNote.isLocal ? 'update' : 'create', activeUser.id);
            } catch (e) {
              console.warn("Background note sync failed, leaving in queue", e);
              refreshCollections(); // Show popup on failure
            }
          })();
        }
      }
    } catch (e) {
      console.error("Failed to save note", e);
      alert("Failed to save note.");
      loadNotes();
    }
  };

  const handleDeleteNote = (note: Note) => {
    setDeleteConfirmation({ id: note.id });
  };

  const handleConfirmDelete = async () => {
    if (deleteConfirmation) {
      const note = notes.find(n => n.id === deleteConfirmation.id);
      setDeleteConfirmation(null); // Close immediately
      if (note) await executeDeleteNote(note);
    } else {
      setDeleteConfirmation(null);
    }
  };

  const handleUploadNote = async (note: Note) => {
    if (!checkOnline() || !activeUser) return;
    try {
      const created = await api.createNote(id!, note.text);
      storage.deleteLocalNote(id!, note.id, activeUser.id);
      setNotes(prev => prev.map(n => n.id === note.id ? created : n)); // Replace local with cloud
    } catch (e) {
      alert("Failed to upload note");
    }
  };

  const executeDeleteNote = async (note: Note) => {
    if (!id || !activeUser) return;

    // Ghost Filter: Block reappearance
    ghostDeletedIds.current.add(note.id);
    storage.saveRecentDelete(note.id);

    setNotes(prev => prev.filter(n => n.id !== note.id));

    if (note.isLocal) {
      storage.deleteLocalNote(id, note.id, activeUser.id);
    } else {
      // Unified Optimistic Flow for Synced Notes
      // 1. Mark as locally deleted / Queue deletion (Always, for data consistency)
      const pending = storage.getPendingChanges(activeUser.id);
      const isPendingCreate = pending.some(p => p.id === note.id && p.op === 'create');

      // Queue delete first (or cancel create)
      storage.queueChange({ type: 'note', op: 'delete', id: note.id, collectionId: id, timestamp: Date.now() }, activeUser.id);

      // 2. Local Cleanup
      if (isPendingCreate) {
        // Was never synced, destroy local copy
        storage.deleteLocalNote(id, note.id, activeUser.id);
      }
      // Else: It was synced. We keep the local copy but the 'delete' queue op + loadNotes filter will hide it.
      // Actually, to be safe against ghosts, we can delete the local override if it exists, relying on queue for "deletion state".

      // 3. Background Sync (if online)
      if (isOnline && !isPendingCreate) {
        (async () => {
          try {
            await api.deleteNote(id, note.id);
            // Success: Cleanup
            storage.deleteLocalNote(id, note.id, activeUser.id);
            storage.removePendingChange(note.id, 'note', 'delete', activeUser.id);
            // We also remove from ghost filter since it's truly gone
            if (activeUser) storage.deleteLocalNote(id, note.id, activeUser.id);
          } catch (e) {
            console.warn("Background note delete failed, left in queue");
          }
        })();
      }
    }

    // 4. Update UI - We already did setNotes(filter), but calling loadNotes handles any re-merge logic if needed?
    // Actually setNotes(prev => filter) is enough for immediate UI. 
    // loadNotes might be redundant or risky if it re-fetches before delete completes. 
    // We skip loadNotes here because we manually updated state.
  };

  const handleDeleteCollection = async () => {
    if (!id || !activeUser) return;
    if (!confirm('Delete this collection and all its notes?')) return;

    if (currentCollection && currentCollection.isLocal) {
      storage.deleteLocalCollection(id, activeUser.id);
      navigate('/');
      refreshCollections();
      return;
    }

    if (checkOnline()) {
      try {
        await api.deleteCollection(id);
        refreshCollections();
        navigate('/');
      } catch (e) {
        alert("Failed to delete collection");
      }
    } else {
      // Offline Collection Delete
      const pending = storage.getPendingChanges(activeUser.id);
      const isPendingCreate = pending.some(p => p.id === id && p.op === 'create');

      storage.queueChange({ type: 'collection', id: id, timestamp: Date.now(), op: 'delete' }, activeUser.id);

      if (isPendingCreate) {
        storage.deleteLocalCollection(id, activeUser.id);
      }

      refreshCollections();
      navigate('/');
    }
  };

  const handleNoteContextMenu = (e: React.MouseEvent, noteId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, id: noteId });
  };

  const modalImages = extractImages(noteText);

  if (!id) return <div className="p-10 text-gray-400">Select a collection</div>;
  if (!currentCollection) return <div className="p-10 text-gray-400">Collection not found</div>;

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden bg-gray-50 dark:bg-zinc-950 pt-16 md:pt-0">
      {/* Header - Optimized for landscape (sm:flex-row) */}
      <header className="bg-white dark:bg-zinc-900 border-b dark:border-zinc-800 px-4 py-3 sm:px-6 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-shrink-0 z-10 transition-colors">
        <div className="flex-shrink-0 flex justify-between items-center sm:block">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white truncate max-w-[200px]">{currentCollection.name}</h2>
              {/* Auth Error Indicator in Header (Mobile/Desktop) */}
            </div>
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5">{filteredNotes.length} notes</p>
          </div>
          {/* We keep flex layout for future controls if needed, but flex-col handles layout */}
        </div>

        <div className="flex-1 w-full sm:max-w-md relative">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            className="pl-9 bg-gray-50/50 dark:bg-zinc-800/50 hover:bg-white dark:hover:bg-zinc-800 focus:bg-white dark:focus:bg-zinc-800 h-9 sm:h-10 text-sm"
            placeholder="Search notes..."
            value={searchQuery}
            onChange={(e: any) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="flex gap-2 flex-shrink-0 justify-end">

          <Button onClick={() => {
            setEditingNote(null);
            setNoteText('');
            setIsNoteModalOpen(true);
            setSaveType(activeUser?.id === 'device-local' ? 'local' : 'cloud');
          }} className="h-9 sm:h-10 px-3 text-xs sm:text-sm">
            <IconPlus className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">New Note</span>
            <span className="inline sm:hidden">New</span>
          </Button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-8">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-400">Loading notes...</div>
        ) : filteredNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 border-2 border-dashed border-gray-200 dark:border-zinc-800 rounded-xl">
            {searchQuery ? (
              <>
                <IconSearch className="w-12 h-12 mb-4 text-gray-300" />
                <p>No matches found.</p>
              </>
            ) : (
              <>
                <IconEdit className="w-12 h-12 mb-4 text-gray-300" />
                <p>No notes yet. Create one to get started.</p>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-20">
            {filteredNotes.filter(n => n && n.id).map(note => (
              <NoteCard
                key={note.id}
                note={note}
                onClick={() => {
                  setEditingNote(note);
                  setNoteText(note.text);
                  setSaveType(note.isLocal ? 'local' : 'cloud');
                  setIsNoteModalOpen(true);
                }}
                onDelete={() => handleDeleteNote(note)}
                onContextMenu={(e: React.MouseEvent) => handleNoteContextMenu(e, note.id)}
                onImageClick={(index: number, images: string[]) => setPreviewData({ images, index })}
              />
            ))}
          </div>
        )}
      </main>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          options={[
            {
              label: 'Delete', onClick: () => {
                const n = notes.find(x => x.id === contextMenu.id);
                if (n) handleDeleteNote(n);
              }, className: 'text-red-600 font-medium'
            }
          ]}
        />
      )}

      <ConfirmationModal
        isOpen={!!deleteConfirmation}
        onClose={() => setDeleteConfirmation(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Note"
        message="Are you sure you want to delete this note? This action cannot be undone."
      />

      {/* Image Preview */}
      {previewData && (
        <ImagePreview
          images={previewData.images}
          startIndex={previewData.index}
          onClose={() => setPreviewData(null)}
        />
      )}

      {/* Note Modal */}
      <Modal
        isOpen={isNoteModalOpen}
        onClose={() => setIsNoteModalOpen(false)}
        title={editingNote ? 'Edit Note' : 'New Note'}
      >
        <div className="space-y-4">
          {modalImages.length > 0 && (
            <div className="-mx-6 -mt-6 mb-4 h-48 bg-gray-50 dark:bg-zinc-800 rounded-t-lg overflow-hidden relative border-b border-gray-100 dark:border-zinc-700 flex-shrink-0">
              <div className="flex h-full overflow-x-auto snap-x snap-mandatory no-scrollbar w-full">
                {modalImages.map((img, i) => (
                  <div key={i} className="flex-shrink-0 h-full relative cursor-zoom-in" onClick={() => setPreviewData({ images: modalImages, index: i })}>
                    <img src={img} alt="" className="h-full w-auto object-contain bg-gray-900 snap-center" />
                  </div>
                ))}
              </div>
              {modalImages.length > 1 && (
                <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded-full backdrop-blur-sm pointer-events-none">
                  {modalImages.length} images
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col border border-gray-200 dark:border-zinc-700 rounded-md overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500 dark:focus-within:ring-indigo-400 bg-gray-50 dark:bg-zinc-800 transition-all">
            <div className="flex items-center gap-1 border-b border-gray-200 dark:border-zinc-700 px-3 py-2 bg-gray-100/50 dark:bg-zinc-800/50">
              <button onMouseDown={(e) => { e.preventDefault(); insertFormat('bold'); }} className="w-7 h-7 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-zinc-700 rounded text-gray-600 dark:text-zinc-400 font-bold text-sm transition-colors" title="Bold">B</button>
              <button onMouseDown={(e) => { e.preventDefault(); insertFormat('italic'); }} className="w-7 h-7 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-zinc-700 rounded text-gray-600 dark:text-zinc-400 italic text-sm transition-colors" title="Italic">I</button>
              <div className="w-px h-4 bg-gray-300 dark:bg-zinc-600 mx-1"></div>
              <button onMouseDown={(e) => { e.preventDefault(); insertFormat('list'); }} className="w-7 h-7 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-zinc-700 rounded text-gray-600 dark:text-zinc-400 text-sm transition-colors" title="List"><i className="fa-solid fa-list-ul"></i></button>
            </div>
            <textarea
              ref={textAreaRef}
              className="w-full h-64 p-4 bg-transparent border-none focus:ring-0 focus:outline-none resize-none text-base leading-relaxed text-gray-900 dark:text-white dark:placeholder:text-zinc-500"
              placeholder="Write your thoughts here..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              autoFocus
            />
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 dark:text-zinc-400 font-medium mr-2">Destination</span>
              <div className="flex bg-gray-100 dark:bg-zinc-800 p-0.5 rounded-lg">
                {activeUser?.id !== 'device-local' && (
                  <button
                    onClick={() => setSaveType('cloud')}
                    disabled={(currentCollection && currentCollection.isLocal)}
                    className={`px-3 py-1 text-xs rounded-md transition-all flex items-center gap-1.5 ${saveType === 'cloud' ? 'bg-white dark:bg-zinc-700 shadow-sm text-indigo-600 dark:text-indigo-400 font-medium' : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 disabled:opacity-50'}`}
                  >
                    <IconCloud className="w-3 h-3" /> Cloud
                  </button>
                )}
                <button
                  onClick={() => setSaveType('local')}
                  className={`px-3 py-1 text-xs rounded-md transition-all flex items-center gap-1.5 ${saveType === 'local' ? 'bg-white dark:bg-zinc-700 shadow-sm text-amber-600 dark:text-amber-500 font-medium' : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'}`}
                >
                  <IconDevice className="w-3 h-3" /> Device
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" onClick={() => setIsNoteModalOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveNote}>Save Note</Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};

const HomeView = ({ collections, onEditCollection, onDeleteCollection, activeUser, accounts, onLogout, onEditAccount, onSwitchAccount }: any) => {
  const navigate = useNavigate();
  const [isAccountsOpen, setIsAccountsOpen] = useState(() => secureStorage.getItem('home_accounts_open') !== 'false');
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, id: string, type: 'collection' | 'account', align?: 'left' | 'right' } | null>(null);

  const toggleAccounts = () => {
    setIsAccountsOpen(prev => {
      const next = !prev;
      secureStorage.setItem('home_accounts_open', String(next));
      return next;
    });
  };

  const handleContextMenu = (e: React.MouseEvent, id: string, type: 'collection' | 'account', align: 'left' | 'right' = 'left') => {
    e.preventDefault();
    e.stopPropagation();

    if (contextMenu?.id === id && contextMenu?.type === type) {
      setContextMenu(null);
      return;
    }

    if (align === 'right') {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setContextMenu({ x: rect.right, y: rect.bottom + 8, id, type, align: 'right' });
    } else {
      setContextMenu({ x: e.clientX, y: e.clientY, id, type, align: 'left' });
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">Home</h1>

      <div className="mb-12">
        <h2 className="text-xs font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wider mb-4">Collections</h2>
        {collections.length === 0 ? (
          <div className="text-gray-400 italic">No collections yet. Create one from the sidebar.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {collections.map((col: Collection) => (
              <div
                key={col.id}
                onClick={() => navigate(`/collection/${col.id}`)}
                onContextMenu={(e) => handleContextMenu(e, col.id, 'collection')}
                className="group bg-white dark:bg-zinc-800/50 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-700 p-5 hover:shadow-md dark:hover:bg-zinc-800 transition-all cursor-pointer relative"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <IconFolder className="w-6 h-6 flex items-center justify-center text-xl text-indigo-500 dark:text-indigo-400 flex-shrink-0" />
                    <h3 className="font-semibold text-gray-900 dark:text-white truncate flex-1 leading-tight">{col.name}</h3>
                    {col.isLocal && <IconDevice className="w-3 h-3 flex items-center justify-center text-xs text-yellow-500 flex-shrink-0" />}
                  </div>
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => handleContextMenu(e, col.id, 'collection', 'right')}
                    className={`p-2 -mr-2 rounded-full transition-all shrink-0 ${contextMenu?.id === col.id && contextMenu?.type === 'collection'
                      ? 'bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-zinc-200'
                      : 'hover:bg-gray-100 dark:hover:bg-zinc-700 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200'
                      }`}
                  >
                    <IconMoreVertical className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <button onClick={toggleAccounts} className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wider mb-4 hover:text-gray-700 dark:hover:text-zinc-300 transition-colors">
          <i className={`fa-solid fa-chevron-${isAccountsOpen ? 'down' : 'right'} w-3`}></i>
          Accounts
        </button>

        {isAccountsOpen && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-in slide-in-from-top-2 duration-200">
            {accounts.map((acc: User) => (
              <div
                key={acc.id}
                onClick={() => onSwitchAccount(acc.id)}
                onContextMenu={(e) => handleContextMenu(e, acc.id, 'account')}
                className="bg-white dark:bg-zinc-800/50 p-4 rounded-xl border border-gray-100 dark:border-zinc-700 flex items-center gap-4 relative group cursor-pointer"
              >
                <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden flex-shrink-0">
                  <img src={acc.avatar} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 dark:text-white truncate">{acc.username}</div>
                  <div className="text-xs text-gray-500 truncate">{acc.id === 'device-local' ? 'Local Device' : 'Synced Account'}</div>
                </div>
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => handleContextMenu(e, acc.id, 'account', 'right')}
                  className={`p-2 -mr-2 rounded-full transition-all ${contextMenu?.id === acc.id && contextMenu?.type === 'account'
                    ? 'bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-zinc-200'
                    : 'hover:bg-gray-100 dark:hover:bg-zinc-700 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200'
                    }`}
                >
                  <IconMoreVertical className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {contextMenu && contextMenu.type === 'collection' && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          align={contextMenu.align}
          onClose={() => setContextMenu(null)}
          options={[
            { label: 'Edit', onClick: () => onEditCollection(contextMenu.id) },
            { label: 'Delete', onClick: () => onDeleteCollection(contextMenu.id), className: 'text-red-600 font-medium' }
          ]}
        />
      )}

      {contextMenu && contextMenu.type === 'account' && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          align={contextMenu.align}
          onClose={() => setContextMenu(null)}
          options={[
            { label: 'Edit', onClick: () => onEditAccount(contextMenu.id) },
            { label: 'Log Out', onClick: () => onLogout(contextMenu.id), className: 'text-red-600 font-medium' }
          ].filter(opt => opt.label !== 'Edit' || contextMenu.id !== 'device-local')}
        />
      )}
    </div>
  );
};

const MainLayout = ({ children, collections, onCreateCollection, onEditCollection, onDeleteCollection, activeUser, accounts, onSwitchAccount, onAddAccount, onEditAccount, onLogout, checkOnline, theme, setTheme, authError, lastSyncTime, offlineAccessUsers, setOfflineAccessUsers, onForceSyncAll, isLoading }: any) => {
  const location = useLocation();
  const activeId = location.pathname.split('/collection/')[1];



  return (
    <div className="flex h-screen bg-white dark:bg-zinc-950 transition-colors">
      <Sidebar
        collections={collections}
        activeId={activeId}
        onCreateCollection={onCreateCollection}
        onEditCollection={onEditCollection}
        onDeleteCollection={onDeleteCollection}
        activeUser={activeUser}
        accounts={accounts}
        onSwitchAccount={onSwitchAccount}
        onAddAccount={onAddAccount}
        onEditAccount={onEditAccount}
        onLogout={onLogout}
        checkOnline={checkOnline}
        theme={theme}
        setTheme={setTheme}
        authError={authError}
        lastSyncTime={lastSyncTime}
        offlineAccessUsers={offlineAccessUsers}
        setOfflineAccessUsers={setOfflineAccessUsers}
        onForceSyncAll={onForceSyncAll}
      // If loading, force sidebar to be disabled/skeleton?
      // Actually, user wants shell visible. If data is empty, sidebar renders fine (empty).
      />
      {isLoading ? (
        children // The children PASSED to MainLayout in the isLoading case IS the spinner div
      ) : (
        children
      )}
    </div>
  );
}

const App = ({ isStorageReady = false }: { isStorageReady?: boolean }) => {


  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('theme')) {
      return localStorage.getItem('theme');
    }
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  });

  const isOnline = useOnlineStatus();

  // State initialization: Start empty, populate when storage is ready
  const [users, setUsers] = useState<User[]>([]);
  const [activeUserId, setActiveUserId] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem('cloudnotes_active_user');
      console.log(`[App] Lazy init activeUser: ${stored}`);
      return stored;
    } catch { return null; }
  });

  // Load data when storage is ready
  // Persist Active User ID whenever it changes
  useEffect(() => {
    if (!isStorageReady) return;
    if (activeUserId) {
      secureStorage.setItem('cloudnotes_active_user', activeUserId);
    } else {
      secureStorage.removeItem('cloudnotes_active_user');
    }
  }, [activeUserId]);


  const activeUser = users.find(u => u.id === activeUserId) || null;

  const [collections, setCollections] = useState<Collection[]>([]);
  const [isCollectionModalOpen, setIsCollectionModalOpen] = useState(false);
  const [collectionName, setCollectionName] = useState('');
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);

  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<User | null>(null);

  const [isOfflineModalOpen, setIsOfflineModalOpen] = useState(false);
  const [pendingDeletes, setPendingDeletes] = useState<any[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ type: 'note' | 'collection', id: string, name?: string } | null>(null);
  const [saveCollectionType, setSaveCollectionType] = useState<'cloud' | 'local'>('cloud');
  const [pendingChangesVersion, setPendingChangesVersion] = useState(0);
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme || 'light');
  }, [theme]);




  // Per-Account Offline Access (Persisted Set of UserIDs)
  const [offlineAccessUsers, setOfflineAccessUsers] = useState<Set<string>>(new Set());

  // Load offline access users once storage is ready
  // Load initial state once storage is ready
  useEffect(() => {
    if (!isStorageReady) return;

    // Load Users
    try {
      const savedUsers = secureStorage.getItem('cloudnotes_users');
      if (savedUsers) {
        setUsers(JSON.parse(savedUsers));
      }
    } catch (e) { }

    // Load Offline Access Preference
    try {
      const saved = secureStorage.getItem('cloudnotes_offline_users');
      if (saved) {
        setOfflineAccessUsers(new Set(JSON.parse(saved)));
      }
    } catch (e) {
      console.error("Failed to load offline users preference", e);
    }
  }, [isStorageReady]);

  // Persist offline access users
  useEffect(() => {
    if (!isStorageReady) return;
    secureStorage.setItem('cloudnotes_offline_users', JSON.stringify([...offlineAccessUsers]));
  }, [offlineAccessUsers]);

  // Fallback: Default to device-local or first user if no active user
  useEffect(() => {
    if (!isStorageReady || !users.length) return;

    // If we already have an active user (from lazy init), do nothing.
    if (activeUserId) return;

    console.log(`[App] No loaded preference. Fallback to default user.`);
    const deviceUser = users.find(u => u.id === 'device-local');
    if (deviceUser) setActiveUserId(deviceUser.id);
    else setActiveUserId(users[0].id);
  }, [isStorageReady, users, activeUserId]);

  // Load Pending Changes
  useEffect(() => {
    if (!activeUser || !isStorageReady) return;
    try {
      setPendingDeletes(storage.getPendingChanges(activeUser.id));
    } catch (e) { }
  }, [activeUser, isStorageReady]);

  const [lastSyncTime, setLastSyncTime] = useState<number>(0);

  // Load Last Sync Time once storage is ready
  useEffect(() => {
    if (!isStorageReady) return;
    const saved = secureStorage.getItem('cloudnotes_global_last_sync');
    if (saved) setLastSyncTime(parseInt(saved));
  }, [isStorageReady]);

  // Persist Active User (Sync to LocalStorage)
  useEffect(() => {
    const stored = localStorage.getItem('cloudnotes_active_user');
    if (activeUserId && activeUserId !== stored) {
      console.log(`[App] Persisting active user to localStorage: ${activeUserId}`);
      localStorage.setItem('cloudnotes_active_user', activeUserId);
    } else if (!activeUserId && stored) {
      console.log(`[App] Clearing active user from localStorage`);
      localStorage.removeItem('cloudnotes_active_user');
    }
  }, [activeUserId]);

  useEffect(() => {
    if (!isOnline) return;

    const runBackgroundSync = async () => {
      const now = Date.now();
      const threshold = 10 * 60 * 1000; // 10 minutes
      let syncedAny = false;

      // Only sync users who have opted-in for offline access
      const enabledUsers = users.filter(u => offlineAccessUsers.has(u.id));

      for (const user of enabledUsers) {
        // Skip current user (handled by foreground sync/swr logic usually, but here we can arguably sync them too if idle)
        // But original logic skipped activeUser to avoid conflict. Let's keep it consistent.
        if (user.id === activeUser?.id) continue;
        if (user.id === 'device-local') continue;

        const lastSyncKey = `cloudnotes_last_bg_sync_${user.id}`;
        const lastSync = parseInt(secureStorage.getItem(lastSyncKey) || '0');

        if (now - lastSync > threshold) {
          try {
            const cols = await api.getCollections(user);
            storage.saveSyncedCollections(cols, user.id);

            for (const col of cols) {
              const notes = await api.getNotes(col.id, user);
              storage.saveSyncedNotes(col.id, notes);
            }

            secureStorage.setItem(lastSyncKey, String(now));
            syncedAny = true;
          } catch (e) { }
        }
      }

      if (syncedAny) {
        setLastSyncTime(now);
        secureStorage.setItem('cloudnotes_global_last_sync', String(now));
      }
    };

    runBackgroundSync();
    const interval = setInterval(runBackgroundSync, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [offlineAccessUsers, isOnline, users, activeUser]);

  const handleForceSyncAll = async () => {
    if (!isOnline) {
      // Optional: Toast "Offline"
      return;
    }

    const enabledUsers = users.filter(u => offlineAccessUsers.has(u.id));

    for (const user of enabledUsers) {
      if (user.id === 'device-local') continue;
      try {
        const cols = await api.getCollections(user);
        storage.saveSyncedCollections(cols, user.id);
        for (const col of cols) {
          const notes = await api.getNotes(col.id, user);
          storage.saveSyncedNotes(col.id, notes);
        }
        secureStorage.setItem(`cloudnotes_last_bg_sync_${user.id}`, String(Date.now()));
      } catch (e) {
      }
    }

    const now = Date.now();
    setLastSyncTime(now);
    secureStorage.setItem('cloudnotes_global_last_sync', String(now));
  };


  const checkOnline = () => {
    if (!isOnline) {
      setIsOfflineModalOpen(true);
      return false;
    }
    return true;
  };

  const refreshPendingChanges = () => {
    if (activeUser) {
      setPendingDeletes(storage.getPendingChanges(activeUser.id));
      setPendingChangesVersion(v => v + 1);
    }
  };

  const syncAllNotes = async (cols: Collection[]) => {
    // Background sync of all notes for offline cache
    if (!activeUser || !isOnline) return;

    // Fix: Ensure API has user set (race condition on reload)
    api.setUser(activeUser);

    for (const col of cols) {
      if (col.isLocal) continue;
      try {
        const notes = await api.getNotes(col.id);
        storage.saveSyncedNotes(col.id, notes);
      } catch (e) {
      }
    }
  };

  const loadCollections = useCallback(async () => {
    if (!activeUser) return;

    // Fix: Ensure API has user set (race condition on reload)
    api.setUser(activeUser);


    // 1. Load Cache (Server State)
    const cachedCols = storage.getCachedCollections(activeUser.id);

    // 2. Load Local Overrides (Created/Edited)
    let localCols = storage.getLocalCollections(activeUser.id);

    let remoteCols: Collection[] = [];
    if (isOnline) {
      try {
        remoteCols = await api.getCollections();
        // Update Cache if Offline Access is enabled for this user
        if (offlineAccessUsers.has(activeUser.id)) {
          storage.saveSyncedCollections(remoteCols, activeUser.id);
        }

        // CLEANUP: Remove local ghosts if they exist on server
        // This handles the "Disappearing" issue by keeping local copy until server confirms existence
        const currentPending = storage.getPendingChanges(activeUser.id);
        remoteCols.forEach(remote => {
          if (localCols.some(l => l.id === remote.id)) {
            const hasPending = currentPending.some(p => p.id === remote.id && p.type === 'collection');
            if (!hasPending) {
              storage.deleteLocalCollection(remote.id, activeUser.id);
            }
          }
        });

        // Refresh localCols after cleanup to ensure UI is correct
        localCols = storage.getLocalCollections(activeUser.id);

        // Trigger background sync (non-blocking) only if enabled
        if (offlineAccessUsers.has(activeUser.id)) {
          syncAllNotes(remoteCols);
        }
      } catch (e) {
        // Fallback to cache only if allowed
        if (offlineAccessUsers.has(activeUser.id)) {
          remoteCols = cachedCols;
        }
      }
    } else {
      // Offline: Only load cache if enabled
      if (offlineAccessUsers.has(activeUser.id)) {
        remoteCols = cachedCols;
      }
    }

    // 3. Merge: Remote (or Cache) + Local Overrides
    const colMap = new Map<string, Collection>();

    // Add remote/cached first
    remoteCols.forEach(c => colMap.set(c.id, c));

    // Apply local overrides
    localCols.forEach(c => {
      // If local exists, it overrides remote with same ID
      colMap.set(c.id, c);
    });

    const merged = Array.from(colMap.values());

    // Filter pending deletes
    const pending = storage.getPendingChanges(activeUser.id);
    const pendingDeletedIds = new Set(pending.filter(p => p.type === 'collection' && p.op === 'delete').map(p => p.id));
    const active = merged.filter(c => !pendingDeletedIds.has(c.id));

    // Sort: Local created first? Or just by created date.
    // Let's sort by name for collections usually, or created. 
    // Existing logic was just merged. Let's keep it simple.
    active.sort((a, b) => b.created - a.created);

    setCollections(active);
  }, [activeUser, isOnline]);



  const loadCollectionsAndPending = async () => {
    await loadCollections();
    refreshPendingChanges();
  };

  useEffect(() => {
    if (activeUser) {
      setPendingDeletes(storage.getPendingChanges(activeUser.id));
    }
  }, [activeUser, isOnline]);

  useEffect(() => {
    secureStorage.setItem('cloudnotes_users', JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    if (activeUserId) {
      secureStorage.setItem('cloudnotes_active_user', activeUserId);
    } else {
      secureStorage.removeItem('cloudnotes_active_user');
    }
  }, [activeUserId]);

  useEffect(() => {
    if (activeUser) {
      api.setUser(activeUser);
      loadCollections();
    } else {
      setCollections([]);
    }
  }, [activeUser, loadCollections]);

  const handleConnect = (user: User) => {
    setUsers(prev => {
      // Prevent duplicates
      if (prev.some(u => u.id === user.id)) return prev;
      return [...prev, user];
    });
    setActiveUserId(user.id);
  };

  const handleUpdateAccount = (updatedUser: User) => {
    setUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));
    if (activeUser && activeUser.id === updatedUser.id) {
      api.setUser(updatedUser);
      loadCollections();
    }
    setEditingAccount(null);
  };

  const handleLogout = (id: string) => {
    const remaining = users.filter(u => u.id !== id);
    setUsers(remaining);
    if (activeUserId === id) {
      setActiveUserId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const handleSwitchAccount = (id: string) => {
    setActiveUserId(id);
    window.location.hash = '/';
  };

  const handleSaveCollection = async () => {
    if (!activeUser) return;

    // Sanitize Input
    const sanitizedName = sanitizeInput(collectionName);
    if (!sanitizedName.trim()) {
      alert("Collection name cannot be empty");
      return;
    }

    let type = saveCollectionType;
    const id = editingCollectionId || crypto.randomUUID();
    const now = Date.now();

    // Auto-Resolve Logic for Collection Renames
    if (editingCollectionId) {
      const cachedCols = storage.getCachedCollections(activeUser.id);
      const originalCached = cachedCols.find(c => c.id === editingCollectionId);

      // If this is a synced collection (exists in cache) and name matches
      if (originalCached && originalCached.name === sanitizedName) {
        storage.removePendingChange(editingCollectionId, 'collection', 'update', activeUser.id);
        storage.deleteLocalCollection(editingCollectionId, activeUser.id); // Remove override

        setIsCollectionModalOpen(false);
        setCollectionName('');
        setEditingCollectionId(null);
        loadCollectionsAndPending();
        return;
      }
    }

    const optimisticCol: Collection = {
      id,
      name: sanitizedName,
      created: now,
      isLocal: type === 'local' // If explicitly local, it stays local. If cloud, it starts as local-ghost.
    };

    try {
      if (type === 'local') {
        storage.saveLocalCollection(optimisticCol, activeUser.id);
        await loadCollections();
      } else {
        // ALWAYS Save Local First (Optimistic)
        // Even for cloud collections, we save a local copy so it appears instantly.
        // `loadCollections` will keep it until the server returns it in `api.getCollections`.
        storage.saveLocalCollection({ ...optimisticCol, isLocal: false }, activeUser.id);

        // Queue change just in case (for offline resilience), providing specific ID
        storage.queueChange({
          type: 'collection',
          op: editingCollectionId ? 'update' : 'create',
          id,
          timestamp: now,
          data: optimisticCol
        }, activeUser.id);

        // Update UI Immediately ONLY if offline or needed for optimistic rendering?
        // Actually loadCollectionsAndPending makes the new collection appear in the sidebar.
        // We MUST call it to show the collection, BUT we can suppress the "pending" state update?
        // loadCollectionsAndPending calls `loadCollections` AND `refreshPendingChanges`.
        // We should split them potentially? Or just accept we need to show the collection.
        // The issue is `pendingDeletes` state triggers the popup.

        // Refactored flow:
        // 1. We need to show the collection in sidebar -> We need to re-read collections.
        // 2. We don't want to update pendingDeletes state if online (to hide popup).

        // Current implementation of loadCollectionsAndPending:
        // const loadCollectionsAndPending = async () => {
        //   await loadCollections();
        //   refreshPendingChanges();
        // };

        // So we can just call loadCollections() here! 
        await loadCollections();

        if (!isOnline) {
          refreshPendingChanges();
        }

        if (isOnline) {
          // Background Sync (Fire and Forget)
          (async () => {
            try {
              if (editingCollectionId) {
                await api.updateCollection(editingCollectionId, sanitizedName);
              } else {
                await api.createCollection(sanitizedName, id);
              }
              // We do NOT await loadCollections here, because we want the local ghost to persist 
              // until the NEXT natural sync cycle or refresh picks it up from the server.
              // Only remove from pending queue to confirm success.
              storage.removePendingChange(id, 'collection', editingCollectionId ? 'update' : 'create', activeUser.id);
            } catch (e) {
              // If fails, it stays in pending queue for background sync
              refreshPendingChanges(); // Show popup on failure
            }
          })();
        }
      }
      setIsCollectionModalOpen(false);
      setCollectionName('');
      setEditingCollectionId(null);
    } catch (e) {
      alert("Failed to save collection");
    }
  };

  const handleSync = async () => {
    if (!isOnline || !activeUser) return;
    setIsSyncing(true);
    const output = [];

    try {
      // Process Changes
      const pending = storage.getPendingChanges(activeUser.id);
      for (const item of pending) {
        try {
          if (item.type === 'note' && item.collectionId) {
            if (item.op === 'delete') {
              await api.deleteNote(item.collectionId, item.id);
            } else if (item.op === 'create') {
              // Pass ID to ensure consistency and prevent "void" notes
              await api.createNote(item.collectionId, item.data.text, item.id);
              // Do NOT delete local copy yet. Wait for loadNotes to confirm it's on server.
            } else if (item.op === 'update') {
              await api.updateNote(item.collectionId, item.id, item.data.text);
              // Do NOT delete local copy yet.
            }
          } else if (item.type === 'collection') {
            if (item.op === 'delete') {
              await api.deleteCollection(item.id);
            } else if (item.op === 'create') {
              // Pass ID to ensure consistency
              await api.createCollection(item.data.name, item.id);
              // Do NOT delete local copy yet. Wait for loadCollections to confirm.
            } else if (item.op === 'update') {
              await api.updateCollection(item.id, item.data.name);
              // Do NOT delete local copy yet.
            }
          }
          storage.removePendingChange(item.id, item.type, item.op, activeUser.id);
        } catch (e: any) {
          if (e.message?.includes("Unauthorized") || e.message?.includes("401")) {
            setAuthError(true);
            // Don't break, try other items just in case, but usually all will fail.
            // We just stop alerting user.
          }
          output.push(`Failed to ${item.op} ${item.type}: ${e.message}`);
        }
      }
      setPendingDeletes(storage.getPendingChanges(activeUser.id));
      await loadCollections();
      if (output.length === 0) {
        // success
      } else {
        alert("Some items failed to sync:\n" + output.join('\n'));
      }
    } catch (e) {
      alert("Sync failed");
    } finally {
      setIsSyncing(false);
    }
  };

  const executeDeleteCollection = async (id: string) => {
    if (!activeUser) return;

    // Check if local
    const col = collections.find(c => c.id === id);
    if (col?.isLocal) {
      storage.deleteLocalCollection(id, activeUser.id);
      await loadCollections();
      return;
    }

    // Unified Optimistic Flow
    // 1. Mark as locally deleted / Queue deletion
    // If it was a pending create (never synced), we just delete it locally.
    const pending = storage.getPendingChanges(activeUser.id);
    const isPendingCreate = pending.some(p => p.id === id && p.op === 'create' && p.type === 'collection');

    if (isPendingCreate) {
      // Was never synced, just kill it locally
      storage.deleteLocalCollection(id, activeUser.id);
      storage.removePendingChange(id, 'collection', 'create', activeUser.id);
    } else {
      // It existed (synced or not), so we queue a delete op and hide it locally
      // Even if online, we do this to update UI instantly
      storage.queueChange({ type: 'collection', op: 'delete', id, timestamp: Date.now() }, activeUser.id);

      // Optimistic remove from UI state
      // We don't deleteLocalCollection immediately if it's synced, because we want to keep the data until server confirms delete?
      // Actually for delete, we WANT to hide it. 
      // We can just rely on `loadCollections` filtering out deleted items? 
      // `loadCollections` filters by `pendingDeletes`. 
      // But `loadCollections` might re-fetch from API immediately if valid.
      // We should add it to a "locally deleted" set or rely on the queue.
      // The queue is used by loadCollections to filter! (See loadCollections logic)
    }

    // 2. Update UI Immediately
    // We want to hide the deleted item immediately. loadCollections does that by checking the pending queue.
    await loadCollections(); // Replaces loadCollectionsAndPending() to avoid triggering popup

    if (!isOnline) {
      refreshPendingChanges();
    }

    // 3. Background Sync (if online)
    if (isOnline && !isPendingCreate) {
      (async () => {
        try {
          await api.deleteCollection(id);
          // Success: Cleanup (remove from queue and delete local cache totally)
          storage.deleteLocalCollection(id, activeUser.id);
          storage.removePendingChange(id, 'collection', 'delete', activeUser.id);
        } catch (e) {
          console.warn("Background collection delete failed, left in queue");
          refreshPendingChanges(); // Show popup on failure
        }
      })();
    }
  };

  const handleDeleteCollection = (id: string) => {
    const col = collections.find(c => c.id === id);
    setDeleteConfirmation({ type: 'collection', id, name: col?.name || 'Collection' });
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmation) return;
    const { type, id } = deleteConfirmation;
    setDeleteConfirmation(null); // Close immediately

    if (type === 'collection') {
      await executeDeleteCollection(id);
    }
  };

  if (!activeUser) {
    if (!isStorageReady) {
      return (
        <HashRouter>
          <MainLayout
            collections={[]}
            activeUser={null}
            accounts={[]}
            theme={theme}
            setTheme={setTheme}
            checkOnline={() => true}
            isLoading={true}
          >
            <div className="flex h-full w-full items-center justify-center bg-gray-50 dark:bg-zinc-950">
              <div className="flex flex-col items-center gap-4">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent"></div>
                <p className="text-sm font-medium text-gray-500 dark:text-zinc-400">Securing your notes...</p>
              </div>
            </div>
          </MainLayout>
        </HashRouter>
      );
    }
    return <LoginScreen onConnect={handleConnect} theme={theme} setTheme={setTheme} />;
  }

  return (
    <HashRouter>
      <MainLayout
        collections={collections}
        onCreateCollection={() => { setCollectionName(''); setEditingCollectionId(null); setIsCollectionModalOpen(true); setSaveCollectionType(activeUser?.id === 'device-local' ? 'local' : 'cloud'); }}
        onEditCollection={(id: string) => {
          const col = collections.find(c => c.id === id);
          if (col) {
            setCollectionName(col.name);
            setEditingCollectionId(id);
            setSaveCollectionType(col.isLocal ? 'local' : 'cloud');
            setIsCollectionModalOpen(true);
          }
        }}
        onDeleteCollection={handleDeleteCollection}
        activeUser={activeUser}
        accounts={users}
        onSwitchAccount={handleSwitchAccount}
        onAddAccount={(user?: User) => {
          if (user) {
            handleConnect(user);
          } else {
            setIsAccountModalOpen(true);
          }
        }}
        onEditAccount={(id: string) => setEditingAccount(users.find(u => u.id === id) || null)}
        onLogout={handleLogout}
        checkOnline={checkOnline}
        theme={theme}
        setTheme={setTheme}
        authError={authError}
        lastSyncTime={lastSyncTime}
        offlineAccessUsers={offlineAccessUsers}
        setOfflineAccessUsers={setOfflineAccessUsers}
        onForceSyncAll={handleForceSyncAll}
      >
        <Routes>
          <Route path="/collection/:id" element={<CollectionView collections={collections} refreshCollections={loadCollectionsAndPending} checkOnline={checkOnline} isOnline={isOnline} pendingChangesVersion={pendingChangesVersion} activeUser={activeUser} onDeleteCollection={handleDeleteCollection} />} />
          <Route path="/" element={<HomeView collections={collections} activeUser={activeUser} accounts={users} onEditCollection={(id: string) => { setCollectionName(collections.find(c => c.id === id)?.name || ''); setEditingCollectionId(id); setSaveCollectionType(collections.find(c => c.id === id)?.isLocal ? 'local' : 'cloud'); setIsCollectionModalOpen(true); }} onDeleteCollection={handleDeleteCollection} onSwitchAccount={handleSwitchAccount} onLogout={handleLogout} onEditAccount={(id: string) => setEditingAccount(users.find(u => u.id === id) || null)} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </MainLayout>

      <Modal isOpen={isCollectionModalOpen} onClose={() => setIsCollectionModalOpen(false)} title={editingCollectionId ? "Edit Collection" : "New Collection"}>
        <div className="space-y-4">
          <Input value={collectionName} onChange={(e: any) => setCollectionName(e.target.value)} placeholder="Collection Name" autoFocus />

          <div className="flex items-center justify-between p-3 rounded-md">
            <span className="text-xs text-gray-500 dark:text-zinc-400 font-medium">Save to</span>
            <div className="flex bg-white dark:bg-zinc-800 p-0.5 rounded-lg border border-gray-200 dark:border-zinc-700 shadow-sm">
              {activeUser?.id !== 'device-local' && (
                <button
                  onClick={() => setSaveCollectionType('cloud')}
                  disabled={!!editingCollectionId}
                  className={`px-3 py-1 text-xs rounded-md transition-all flex items-center gap-1.5 ${saveCollectionType === 'cloud' ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium' : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 disabled:opacity-50'}`}
                >
                  <IconCloud className="w-3 h-3" /> Cloud
                </button>
              )}
              <button
                onClick={() => setSaveCollectionType('local')}
                disabled={!!editingCollectionId}
                className={`px-3 py-1 text-xs rounded-md transition-all flex items-center gap-1.5 ${saveCollectionType === 'local' ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-500 font-medium' : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'}`}
              >
                <IconDevice className="w-3 h-3" /> Device
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setIsCollectionModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveCollection}>Save</Button>
          </div>
        </div>
      </Modal>

      {activeUser?.id !== 'device-local' && (
        <PendingSyncManager
          pendingChanges={pendingDeletes}
          onSync={handleSync}
          isSyncing={isSyncing}
          isOnline={isOnline}
          onDiscard={(item: any) => {
            if (!activeUser) return;
            storage.removePendingChange(item.id, item.type, item.op, activeUser.id);
            // If we discard a 'create' op, we should remove the local ghost item
            if (item.op === 'create') {
              if (item.type === 'note') storage.deleteLocalNote(item.collectionId, item.id, activeUser.id);
              if (item.type === 'collection') storage.deleteLocalCollection(item.id, activeUser.id);
            }
            // If we discard an 'update' op, we should remove the local override to revert to server state
            if (item.op === 'update' && item.type === 'note') {
              storage.deleteLocalNote(item.collectionId, item.id, activeUser.id);
            }

            refreshPendingChanges();
            loadCollections();
          }}
        />
      )}

      <Modal isOpen={isAccountModalOpen} onClose={() => setIsAccountModalOpen(false)} title="Add Account">
        <ConnectionForm onConnect={(user) => { handleConnect(user); setIsAccountModalOpen(false); }} showCancel onCancel={() => setIsAccountModalOpen(false)} />
      </Modal>

      <Modal isOpen={!!editingAccount} onClose={() => setEditingAccount(null)} title="Edit Account">
        {editingAccount && (
          <ConnectionForm initialValues={{ apiUrl: editingAccount.apiUrl || '', apiToken: editingAccount.apiToken || '' }} onConnect={(updatedValues) => handleUpdateAccount({ ...updatedValues, id: editingAccount.id })} showCancel onCancel={() => setEditingAccount(null)} />
        )}
      </Modal>

      <OfflineModal isOpen={isOfflineModalOpen} onClose={() => setIsOfflineModalOpen(false)} />
      <ConfirmationModal
        isOpen={!!deleteConfirmation}
        onClose={() => setDeleteConfirmation(null)}
        onConfirm={handleConfirmDelete}
        title={`Delete ${deleteConfirmation?.type === 'collection' ? 'Collection' : 'Note'}`}
        message={`Are you sure you want to delete ${deleteConfirmation?.type === 'collection' ? `"${deleteConfirmation.name}"` : 'this note'}? This action cannot be undone.`}
      />
    </HashRouter>
  );
};


const SecureAppWrapper = () => {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    secureStorage.init().then(() => setIsReady(true));
  }, []);

  return <App isStorageReady={isReady} />;
};

export default SecureAppWrapper;