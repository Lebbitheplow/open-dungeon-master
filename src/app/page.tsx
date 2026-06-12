"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Aperture,
  BookOpen,
  Check,
  Cpu,
  ImagePlus,
  Library,
  Loader2,
  Paperclip,
  Plus,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import {
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/cn";
import { DEFAULT_STORY_SETTINGS, titleFromInput } from "@/lib/defaults";
import { LOCAL_TEXT_MODELS, type LocalTextModelId, type TextProvider } from "@/lib/text-models";
import type {
  AspectPreset,
  Attachment,
  GeneratedImage,
  ImageBackend,
  ImageMode,
  StoryChat,
  StoryCharacter,
  StoryChatSummary,
  StoryMessage,
  StorySettings,
} from "@/lib/types";

const SELECTED_CHAT_KEY = "local-roleplay:selected-chat";
const MAX_IMAGE_REFERENCES = 2;

const KICKOFF_DIRECTIVE =
  "Begin the story now. Write the opening passage: establish the scene, the player character, and the immediate situation in second person, ending on a beat that invites the player's first action. Do not ask the player any setup questions; the story has already started.";

const STORY_PRESETS = [
  {
    id: "fantasy",
    label: "Fantasy",
    flavor: "Knights, magic, old roads",
    seed: "A high-fantasy realm of feuding kingdoms, old magic, and roads that stop being safe after dark.",
    rolePlaceholder: "a wandering sellsword",
  },
  {
    id: "mystery",
    label: "Mystery",
    flavor: "Rain, secrets, loose threads",
    seed: "A rain-slicked city full of secrets, where every case is a door somebody wants kept shut.",
    rolePlaceholder: "a private investigator",
  },
  {
    id: "cyberpunk",
    label: "Cyberpunk",
    flavor: "Neon, chrome, bad debts",
    seed: "A neon-drenched megacity run by corporations, where memory is currency and everyone owes someone.",
    rolePlaceholder: "a burned-out netrunner",
  },
  {
    id: "apocalyptic",
    label: "Apocalyptic",
    flavor: "After the end of everything",
    seed: "Years after the collapse, scattered survivors scavenge, barter, and tell stories about how it used to be.",
    rolePlaceholder: "a scavenger with a map",
  },
  {
    id: "horror",
    label: "Horror",
    flavor: "Something is wrong here",
    seed: "A remote town where the nights run long and the locals don't talk about what happens in them.",
    rolePlaceholder: "an out-of-town visitor",
  },
  {
    id: "romance",
    label: "Romance",
    flavor: "Sparks in unlikely places",
    seed: "A close-knit coastal town in late summer, where chance meetings have a way of becoming something more.",
    rolePlaceholder: "a newcomer with a past",
  },
] as const;

type StoryPresetId = (typeof STORY_PRESETS)[number]["id"] | "custom";

type ImageStatus = Record<string, "loading" | "error">;
type ChatResponse = { chat: StoryChat };
type ChatsResponse = { chats: StoryChatSummary[] };
type CharacterResponse = { character: StoryCharacter };
type CharacterDraft = {
  name: string;
  details: string;
  portrait?: Attachment;
};
type MobileTool = "characters" | "story" | "images" | "data";
type LocalTextStatus = { ok: boolean; installedModels: string[] };

function makeId() {
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readApi<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as unknown;

  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `Request failed (${response.status}).`;
    throw new Error(message);
  }

  return payload as T;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function uploadImageFile(file: File) {
  const dataUrl = await fileToDataUrl(file);
  const response = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl, name: file.name, type: file.type }),
  });

  return readApi<Attachment>(response);
}

// Narrator models often use markdown emphasis; render just *italic* and
// **bold** inline without pulling in a full markdown pipeline.
function renderStoryEmphasis(content: string): ReactNode[] {
  return content.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g).map((segment, index) => {
    if (segment.startsWith("**") && segment.endsWith("**") && segment.length > 4) {
      return <strong key={index}>{segment.slice(2, -2)}</strong>;
    }
    if (segment.startsWith("*") && segment.endsWith("*") && segment.length > 2) {
      return <em key={index}>{segment.slice(1, -1)}</em>;
    }
    return segment;
  });
}

function formatChatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function chatToSummary(chat: StoryChat): StoryChatSummary {
  return {
    id: chat.id,
    title: chat.title,
    settings: chat.settings,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messageCount: chat.messageCount,
    lastMessagePreview: chat.lastMessagePreview,
  };
}

export default function Home() {
  const [chats, setChats] = useState<StoryChatSummary[]>([]);
  const [selectedChatId, setSelectedChatId] = useState("");
  const [messages, setMessages] = useState<StoryMessage[]>([]);
  const [characters, setCharacters] = useState<StoryCharacter[]>([]);
  const [characterDraft, setCharacterDraft] = useState<CharacterDraft>({
    name: "",
    details: "",
  });
  const [settings, setSettings] = useState<StorySettings>(DEFAULT_STORY_SETTINGS);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [characterSaving, setCharacterSaving] = useState(false);
  const [characterUploadingId, setCharacterUploadingId] = useState("");
  const [clearingLocalData, setClearingLocalData] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [loadingChat, setLoadingChat] = useState(false);
  const [error, setError] = useState("");
  const [imageStatus, setImageStatus] = useState<ImageStatus>({});
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [mobileTool, setMobileTool] = useState<MobileTool>("characters");
  const [localTextStatus, setLocalTextStatus] = useState<LocalTextStatus | null>(null);
  const [newStoryOpen, setNewStoryOpen] = useState(false);
  const lastSavedSettingsRef = useRef(JSON.stringify(DEFAULT_STORY_SETTINGS));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId),
    [chats, selectedChatId],
  );

  const lastUserAttachments = useMemo(() => {
    return [...messages].reverse().find((message) => message.role === "user")?.attachments || [];
  }, [messages]);

  const applyChat = useCallback((chat: StoryChat) => {
    setSelectedChatId(chat.id);
    window.localStorage.setItem(SELECTED_CHAT_KEY, chat.id);
    setMessages(chat.messages);
    setCharacters(chat.characters || []);
    setCharacterDraft({ name: "", details: "" });
    setSettings(chat.settings);
    setAttachments([]);
    setImageStatus({});
    lastSavedSettingsRef.current = JSON.stringify(chat.settings);
  }, []);

  const refreshChats = useCallback(async () => {
    const response = await fetch("/api/chats", { cache: "no-store" });
    const payload = await readApi<ChatsResponse>(response);
    setChats(payload.chats);
    return payload.chats;
  }, []);

  const loadChat = useCallback(
    async (chatId: string) => {
      setLoadingChat(true);
      setError("");

      try {
        const response = await fetch(`/api/chats/${chatId}`, { cache: "no-store" });
        const payload = await readApi<ChatResponse>(response);
        applyChat(payload.chat);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Chat failed to load.");
      } finally {
        setLoadingChat(false);
      }
    },
    [applyChat],
  );

  const clearSelectedChat = useCallback(() => {
    window.localStorage.removeItem(SELECTED_CHAT_KEY);
    setSelectedChatId("");
    setMessages([]);
    setCharacters([]);
    setCharacterDraft({ name: "", details: "" });
    setSettings(DEFAULT_STORY_SETTINGS);
    setAttachments([]);
    setImageStatus({});
    lastSavedSettingsRef.current = JSON.stringify(DEFAULT_STORY_SETTINGS);
  }, []);

  const deleteChatById = useCallback(
    async (chatId: string) => {
      setError("");

      try {
        const response = await fetch(`/api/chats/${chatId}`, { method: "DELETE" });
        await readApi<{ ok: true }>(response);
        const remainingChats = await refreshChats();

        if (chatId !== selectedChatId) {
          return;
        }

        if (remainingChats.length) {
          await loadChat(remainingChats[0].id);
          return;
        }

        clearSelectedChat();
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : "Delete failed.");
      }
    },
    [clearSelectedChat, loadChat, refreshChats, selectedChatId],
  );

  const clearAllLocalData = useCallback(async () => {
    setClearingLocalData(true);
    setError("");

    try {
      const response = await fetch("/api/local-data", { method: "DELETE" });
      await readApi<{ ok: true }>(response);

      setChats([]);
      clearSelectedChat();
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "Local data clear failed.");
    } finally {
      setClearingLocalData(false);
    }
  }, [clearSelectedChat]);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      setLibraryLoading(true);
      setError("");

      try {
        const nextChats = await refreshChats();
        let nextChatId = window.localStorage.getItem(SELECTED_CHAT_KEY) || "";

        if (!nextChats.some((chat) => chat.id === nextChatId)) {
          nextChatId = nextChats[0]?.id || "";
        }

        if (nextChatId && !cancelled) {
          const response = await fetch(`/api/chats/${nextChatId}`, { cache: "no-store" });
          const payload = await readApi<ChatResponse>(response);
          if (!cancelled) {
            applyChat(payload.chat);
          }
        }
      } catch (bootError) {
        if (!cancelled) {
          setError(bootError instanceof Error ? bootError.message : "Chat library failed to load.");
        }
      } finally {
        if (!cancelled) {
          setLibraryLoading(false);
        }
      }
    }

    void boot();

    return () => {
      cancelled = true;
    };
  }, [applyChat, refreshChats]);

  useEffect(() => {
    let cancelled = false;

    async function checkLocalText() {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as {
          localText?: LocalTextStatus;
        };
        if (!cancelled) {
          setLocalTextStatus(payload.localText ?? { ok: false, installedModels: [] });
        }
      } catch {
        if (!cancelled) {
          setLocalTextStatus({ ok: false, installedModels: [] });
        }
      }
    }

    void checkLocalText();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedChatId || libraryLoading || loadingChat) {
      return;
    }

    const serialized = JSON.stringify(settings);
    if (serialized === lastSavedSettingsRef.current) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/chats/${selectedChatId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings }),
          signal: controller.signal,
        });
        const payload = await readApi<ChatResponse>(response);
        lastSavedSettingsRef.current = JSON.stringify(payload.chat.settings);
        setChats((current) =>
          current.map((chat) =>
            chat.id === payload.chat.id ? chatToSummary(payload.chat) : chat,
          ),
        );
      } catch (saveError) {
        if (!controller.signal.aborted) {
          setError(saveError instanceof Error ? saveError.message : "Settings failed to save.");
        }
      }
    }, 500);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [libraryLoading, loadingChat, selectedChatId, settings]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy, imageStatus]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) {
      return;
    }

    setUploading(true);
    setError("");

    try {
      const uploaded: Attachment[] = [];
      for (const file of Array.from(files).slice(0, MAX_IMAGE_REFERENCES)) {
        uploaded.push(await uploadImageFile(file));
      }
      setAttachments((current) => [...current, ...uploaded].slice(0, MAX_IMAGE_REFERENCES));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Image upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  const referencesForImage = useCallback(
    (characterIds: string[] | undefined, turnRefs: Attachment[]) => {
      const characterRefs = (characterIds || []).flatMap((characterId) => {
        const portrait = characters.find((character) => character.id === characterId)?.portrait;
        return portrait ? [portrait] : [];
      });
      const seen = new Set<string>();

      return [...characterRefs, ...turnRefs]
        .filter((reference) => {
          if (seen.has(reference.id)) {
            return false;
          }
          seen.add(reference.id);
          return true;
        })
        .slice(0, MAX_IMAGE_REFERENCES);
    },
    [characters],
  );

  async function createCharacterFromDraft() {
    const name = characterDraft.name.trim();

    if (!selectedChatId || !name || characterSaving) {
      return;
    }

    setCharacterSaving(true);
    setError("");

    try {
      const response = await fetch(`/api/chats/${selectedChatId}/characters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          details: characterDraft.details,
          portrait: characterDraft.portrait,
        }),
      });
      const payload = await readApi<CharacterResponse>(response);
      setCharacters((current) => [
        payload.character,
        ...current.filter((character) => character.id !== payload.character.id),
      ]);
      setCharacterDraft({ name: "", details: "" });
      void refreshChats();
    } catch (characterError) {
      setError(characterError instanceof Error ? characterError.message : "Character failed to save.");
    } finally {
      setCharacterSaving(false);
    }
  }

  async function updateCharacterById(
    characterId: string,
    updates: { name?: string; details?: string; portrait?: Attachment | null },
  ) {
    if (!selectedChatId) {
      return;
    }

    setError("");

    try {
      const response = await fetch(`/api/chats/${selectedChatId}/characters/${characterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const payload = await readApi<CharacterResponse>(response);
      setCharacters((current) =>
        current.map((character) =>
          character.id === payload.character.id ? payload.character : character,
        ),
      );
      void refreshChats();
    } catch (characterError) {
      setError(characterError instanceof Error ? characterError.message : "Character failed to update.");
    }
  }

  async function uploadCharacterPortrait(file: File, characterId?: string) {
    const uploadId = characterId || "draft";
    setCharacterUploadingId(uploadId);
    setError("");

    try {
      const portrait = await uploadImageFile(file);

      if (!characterId) {
        setCharacterDraft((current) => ({ ...current, portrait }));
        return;
      }

      await updateCharacterById(characterId, { portrait });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Character portrait upload failed.");
    } finally {
      setCharacterUploadingId("");
    }
  }

  async function deleteCharacterById(characterId: string) {
    if (!selectedChatId) {
      return;
    }

    setError("");

    try {
      const response = await fetch(`/api/chats/${selectedChatId}/characters/${characterId}`, {
        method: "DELETE",
      });
      await readApi<{ ok: true }>(response);
      setCharacters((current) => current.filter((character) => character.id !== characterId));
      void refreshChats();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Character delete failed.");
    }
  }

  async function requestGeneratedImage(
    messageId: string,
    prompt: string,
    refs: Attachment[],
    imageRequest?: StoryMessage["imageRequest"],
  ) {
    setImageStatus((current) => ({ ...current, [messageId]: "loading" }));

    try {
      const response = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId,
          prompt,
          mode: imageRequest?.mode || settings.imageMode,
          backend: imageRequest?.backend || settings.imageBackend,
          aspect: imageRequest?.aspect || settings.aspect,
          references: refs,
        }),
      });
      const generatedImage = await readApi<GeneratedImage>(response);

      setMessages((current) =>
        current.map((message) =>
          message.id === messageId ? { ...message, generatedImage } : message,
        ),
      );
      setImageStatus((current) => {
        const next = { ...current };
        delete next[messageId];
        return next;
      });
      void refreshChats();
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : "Image generation failed.");
      setImageStatus((current) => ({ ...current, [messageId]: "error" }));
    }
  }

  async function kickoffStory(chat: StoryChat) {
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: chat.id,
          kickoff: true,
          input: KICKOFF_DIRECTIVE,
          messages: [],
          attachments: [],
          settings: chat.settings,
        }),
      });
      const payload = await readApi<{
        id?: string;
        content: string;
        imageRequest?: StoryMessage["imageRequest"];
      }>(response);

      const assistantMessage: StoryMessage = {
        id: payload.id || makeId(),
        role: "assistant",
        content: payload.content,
        createdAt: new Date().toISOString(),
        imageRequest: payload.imageRequest,
      };

      setMessages((current) => [...current, assistantMessage]);
      void refreshChats();

      if (payload.imageRequest?.needed && payload.imageRequest.prompt) {
        void requestGeneratedImage(
          assistantMessage.id,
          payload.imageRequest.prompt,
          referencesForImage(payload.imageRequest.characterIds, []),
          payload.imageRequest,
        );
      }
    } catch (storyError) {
      setError(storyError instanceof Error ? storyError.message : "Story request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function beginStory(options: { title: string; world: string }) {
    setNewStoryOpen(false);
    setError("");

    try {
      const seedSettings: StorySettings = { ...settings, world: options.world };
      const response = await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: seedSettings, title: options.title }),
      });
      const payload = await readApi<ChatResponse>(response);
      setChats((current) => [
        payload.chat,
        ...current.filter((chat) => chat.id !== payload.chat.id),
      ]);
      applyChat(payload.chat);
      void refreshChats();
      await kickoffStory(payload.chat);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "New story failed.");
    }
  }

  async function submitTurn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = input.trim();
    if (!trimmed || busy || !selectedChatId) {
      return;
    }

    const conversationBeforeTurn = messages;
    const turnAttachments = attachments;
    const userMessage: StoryMessage = {
      id: makeId(),
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
      attachments: turnAttachments,
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setAttachments([]);
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: selectedChatId,
          userMessageId: userMessage.id,
          input: trimmed,
          messages: conversationBeforeTurn,
          attachments: turnAttachments,
          settings,
        }),
      });
      const payload = await readApi<{
        id?: string;
        content: string;
        imageRequest?: StoryMessage["imageRequest"];
      }>(response);

      const assistantMessage: StoryMessage = {
        id: payload.id || makeId(),
        role: "assistant",
        content: payload.content,
        createdAt: new Date().toISOString(),
        imageRequest: payload.imageRequest,
      };

      setMessages((current) => [...current, assistantMessage]);
      void refreshChats();

      if (payload.imageRequest?.needed && payload.imageRequest.prompt) {
        void requestGeneratedImage(
          assistantMessage.id,
          payload.imageRequest.prompt,
          referencesForImage(payload.imageRequest.characterIds, turnAttachments),
          payload.imageRequest,
        );
      }
    } catch (storyError) {
      setError(storyError instanceof Error ? storyError.message : "Story request failed.");
      void refreshChats();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex h-dvh min-h-dvh flex-1 overflow-hidden bg-[#130d09] text-stone-100">
      <section className="mx-auto flex h-dvh min-h-0 w-full max-w-7xl flex-1 flex-col px-3 pt-3 sm:px-4 md:px-8 md:pt-4">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-800/80 pb-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-amber-200/20 bg-amber-200/10">
              <BookOpen className="size-4 text-amber-200" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-balance text-base font-semibold text-stone-100">
                {activeChat?.title || "Open Dungeon"}
              </h1>
              <p className="truncate text-xs text-stone-500">
                {settings.textProvider === "local"
                  ? `${
                      LOCAL_TEXT_MODELS.find((model) => model.id === settings.localTextModel)
                        ?.label ?? "Local model"
                    } · on-device`
                  : "OpenRouter · cloud"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label="Open story tools"
              onClick={() => setMobileToolsOpen(true)}
              className="inline-flex size-10 items-center justify-center rounded border border-stone-700 text-stone-300 hover:bg-stone-900 lg:hidden"
            >
              <Settings2 className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setNewStoryOpen(true)}
              className="inline-flex h-10 items-center gap-2 rounded border border-stone-700 px-3 text-sm text-stone-300 hover:bg-stone-900"
            >
              <Plus className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">New story</span>
              <span className="sm:hidden">New</span>
            </button>
          </div>
        </header>

        <MobileChatBar
          chats={chats}
          selectedChatId={selectedChatId}
          disabled={libraryLoading || loadingChat}
          onSelect={(chatId) => void loadChat(chatId)}
          onDelete={(chatId) => void deleteChatById(chatId)}
        />

        <MobileToolsSheet
          open={mobileToolsOpen}
          activeTool={mobileTool}
          onActiveToolChange={setMobileTool}
          onClose={() => setMobileToolsOpen(false)}
          characters={characters}
          draft={characterDraft}
          creating={characterSaving}
          uploadingId={characterUploadingId}
          onDraftChange={setCharacterDraft}
          onDraftPortrait={(file) => void uploadCharacterPortrait(file)}
          onCreateCharacter={() => void createCharacterFromDraft()}
          onLocalCharacterChange={(characterId, updates) =>
            setCharacters((current) =>
              current.map((character) =>
                character.id === characterId ? { ...character, ...updates } : character,
              ),
            )
          }
          onSaveCharacter={(character) =>
            void updateCharacterById(character.id, {
              name: character.name,
              details: character.details,
            })
          }
          onPortraitFile={(characterId, file) => void uploadCharacterPortrait(file, characterId)}
          onClearPortrait={(characterId) => void updateCharacterById(characterId, { portrait: null })}
          onDeleteCharacter={(characterId) => void deleteCharacterById(characterId)}
          settings={settings}
          setSettings={setSettings}
          localTextStatus={localTextStatus}
          clearingLocalData={clearingLocalData}
          onClearLocalData={() => void clearAllLocalData()}
        />

        {newStoryOpen && (
          <NewStoryDialog
            onClose={() => setNewStoryOpen(false)}
            onBegin={(options) => void beginStory(options)}
          />
        )}

        <div className="grid min-h-0 flex-1 overflow-hidden gap-4 py-3 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6 lg:py-6">
          <section className="flex h-full min-h-0 flex-col">
            <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-8 overflow-y-auto overscroll-contain pr-1 pb-3 sm:space-y-10">
                {libraryLoading || loadingChat ? (
                  <StorySkeleton />
                ) : messages.length === 0 && !busy ? (
                  <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
                    <div className="flex size-12 items-center justify-center rounded-xl border border-amber-200/20 bg-amber-200/10">
                      <BookOpen className="size-5 text-amber-200" aria-hidden="true" />
                    </div>
                    <div className="max-w-sm">
                      <p className="text-balance font-serif text-2xl text-stone-200">
                        Every story starts with a single line.
                      </p>
                      <p className="mt-2 text-pretty text-sm text-stone-500">
                        Begin a story and describe what you do — the narrator takes it from
                        there, scenes and all.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNewStoryOpen(true)}
                      className="inline-flex h-10 items-center gap-2 rounded-lg bg-amber-200 px-4 text-sm font-medium text-stone-950 hover:bg-amber-100"
                    >
                      <Plus className="size-4" aria-hidden="true" />
                      Begin a new story
                    </button>
                  </div>
                ) : (
                  messages.map((message) => (
                    <article key={message.id} className="group">
                      {message.role === "user" ? (
                        <div className="ml-auto max-w-[92%] rounded-2xl rounded-br-md border border-stone-800/70 bg-stone-900/60 px-4 py-3 text-sm leading-6 text-stone-300 sm:max-w-2xl">
                          <p className="text-pretty whitespace-pre-wrap">{message.content}</p>
                          {!!message.attachments?.length && (
                            <AttachmentStrip attachments={message.attachments} className="mt-3" />
                          )}
                        </div>
                      ) : (
                        <div className="font-serif text-[1.13rem] leading-8 text-stone-100 sm:text-[1.3rem] sm:leading-9 md:text-[1.48rem] md:leading-10">
                          <p className="text-pretty whitespace-pre-wrap">
                            {renderStoryEmphasis(message.content)}
                          </p>
                          {(message.generatedImage || message.imageRequest?.needed) && (
                            <ImageBeat
                              message={message}
                              status={imageStatus[message.id]}
                              onRetry={() =>
                                message.imageRequest?.prompt &&
                                requestGeneratedImage(
                                  message.id,
                                  message.imageRequest.prompt,
                                  referencesForImage(
                                    message.imageRequest.characterIds,
                                    lastUserAttachments,
                                  ),
                                  message.imageRequest,
                                )
                              }
                            />
                          )}
                        </div>
                      )}
                    </article>
                  ))
                )}

                {busy && (
                  <div className="flex items-center gap-3 font-serif text-base italic text-stone-500">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    The next passage is forming…
                  </div>
                )}
                <div ref={endRef} />
              </div>

              <form
                onSubmit={submitTurn}
                className="shrink-0 border-t border-stone-800 bg-[#130d09] pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:pt-4 lg:pb-0"
              >
                {error && (
                  <div className="mb-3 rounded border border-red-900/80 bg-red-950/30 px-3 py-2 text-sm text-red-200">
                    {error}
                  </div>
                )}

                {!!attachments.length && (
                  <AttachmentStrip
                    attachments={attachments}
                    className="mb-3"
                    onRemove={(id) =>
                      setAttachments((current) => current.filter((item) => item.id !== id))
                    }
                  />
                )}

                <div className="rounded-2xl border border-stone-700/80 bg-stone-950 focus-within:border-amber-300/60">
                  <input
                    id="reference-images"
                    name="reference-images"
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    className="hidden"
                    onChange={(event) => handleFiles(event.target.files)}
                  />
                  <textarea
                    id="story-input"
                    name="story-input"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    rows={2}
                    placeholder="What do you do?"
                    className="max-h-40 min-h-16 w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-base text-stone-100 outline-none placeholder:text-stone-600 disabled:cursor-not-allowed disabled:text-stone-600 sm:min-h-20"
                    disabled={libraryLoading || loadingChat}
                  />
                  <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
                    <button
                      type="button"
                      aria-label="Attach image references"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex size-9 shrink-0 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-900 hover:text-stone-200 disabled:cursor-not-allowed disabled:text-stone-600"
                      disabled={uploading || libraryLoading}
                    >
                      {uploading ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Paperclip className="size-4" aria-hidden="true" />
                      )}
                    </button>
                    <div className="flex items-center gap-3">
                      <span className="hidden text-xs text-stone-600 sm:inline">⌘↵ to send</span>
                      <button
                        type="submit"
                        aria-label="Send"
                        disabled={busy || !input.trim() || !selectedChatId || libraryLoading}
                        className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-amber-200 px-4 text-sm font-medium text-stone-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:bg-stone-800 disabled:text-stone-500"
                      >
                        <Send className="size-4" aria-hidden="true" />
                        <span className="hidden sm:inline">Send</span>
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            </div>
          </section>

          <aside className="hidden min-h-0 border-l border-stone-800 pl-6 lg:block">
            <div className="sticky top-6 max-h-[calc(100dvh-3rem)] space-y-6 overflow-y-auto pr-1">
              <ChatLibrary
                chats={chats}
                selectedChatId={selectedChatId}
                loading={libraryLoading}
                onCreate={() => setNewStoryOpen(true)}
                onSelect={(chatId) => void loadChat(chatId)}
                onDelete={(chatId) => void deleteChatById(chatId)}
              />

              <CharacterPanel
                characters={characters}
                draft={characterDraft}
                creating={characterSaving}
                uploadingId={characterUploadingId}
                onDraftChange={setCharacterDraft}
                onDraftPortrait={(file) => void uploadCharacterPortrait(file)}
                onCreate={() => void createCharacterFromDraft()}
                onLocalChange={(characterId, updates) =>
                  setCharacters((current) =>
                    current.map((character) =>
                      character.id === characterId ? { ...character, ...updates } : character,
                    ),
                  )
                }
                onSave={(character) =>
                  void updateCharacterById(character.id, {
                    name: character.name,
                    details: character.details,
                  })
                }
                onPortraitFile={(characterId, file) => void uploadCharacterPortrait(file, characterId)}
                onClearPortrait={(characterId) => void updateCharacterById(characterId, { portrait: null })}
                onDelete={(characterId) => void deleteCharacterById(characterId)}
              />

              <TextModelPanel
                settings={settings}
                setSettings={setSettings}
                localTextStatus={localTextStatus}
              />

              <StorySettingsPanel settings={settings} setSettings={setSettings} />

              <ImageSettingsPanel settings={settings} setSettings={setSettings} />

              <LocalDataPanel
                clearing={clearingLocalData}
                onClear={() => void clearAllLocalData()}
              />
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function NewStoryDialog({
  onClose,
  onBegin,
}: {
  onClose: () => void;
  onBegin: (options: { title: string; world: string }) => void;
}) {
  const [presetId, setPresetId] = useState<StoryPresetId>("fantasy");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [customWorld, setCustomWorld] = useState("");

  const isCustom = presetId === "custom";
  const preset = STORY_PRESETS.find((item) => item.id === presetId) ?? STORY_PRESETS[0];
  const canBegin = !isCustom || customWorld.trim().length > 0;

  function begin() {
    if (isCustom) {
      const world = customWorld.trim();
      onBegin({ world, title: titleFromInput(world) });
      return;
    }

    const persona = role.trim() || preset.rolePlaceholder;
    const protagonist = name.trim() ? `${name.trim()}, ${persona}` : persona;
    onBegin({
      world: `${preset.seed} You are ${protagonist}.`,
      title: titleFromInput(
        name.trim() ? `${name.trim()} · ${preset.label}` : `${preset.label} · ${persona}`,
      ),
    });
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-stone-950/80" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[min(calc(100vw-2rem),580px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-stone-700 bg-[#130d09] p-5 shadow-xl"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-balance text-base font-semibold text-stone-100">
                New story
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-pretty text-sm text-stone-500">
                Pick a setting and say who you are — the narrator writes the opening scene.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-stone-800 text-stone-400 hover:bg-stone-900 hover:text-stone-100"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              ...STORY_PRESETS,
              { id: "custom" as const, label: "Custom", flavor: "Describe your own opening" },
            ].map((item) => {
              const selected = item.id === presetId;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setPresetId(item.id)}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-left",
                    selected
                      ? "border-amber-200/70 bg-stone-900"
                      : "border-stone-800 bg-stone-950 hover:bg-stone-900",
                  )}
                >
                  <span className="block text-sm font-medium text-stone-200">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-stone-500">{item.flavor}</span>
                </button>
              );
            })}
          </div>

          {isCustom ? (
            <label className="mt-4 block">
              <span className="mb-2 block text-xs font-medium uppercase text-stone-500">
                What is this story about?
              </span>
              <textarea
                id="new-story-custom"
                name="new-story-custom"
                value={customWorld}
                onChange={(event) => setCustomWorld(event.target.value)}
                rows={4}
                placeholder="You are a lighthouse keeper on a coast where the fog has started whispering back. Last night the light went out on its own..."
                className="w-full resize-none rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-200 outline-none focus:border-amber-300"
              />
            </label>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-xs font-medium uppercase text-stone-500">
                  Who are you?
                </span>
                <input
                  id="new-story-role"
                  name="new-story-role"
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                  placeholder={preset.rolePlaceholder}
                  className="w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-200 outline-none focus:border-amber-300"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-medium uppercase text-stone-500">
                  Name <span className="normal-case text-stone-600">(optional)</span>
                </span>
                <input
                  id="new-story-name"
                  name="new-story-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Alice Fordring"
                  className="w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-200 outline-none focus:border-amber-300"
                />
              </label>
            </div>
          )}

          <div className="mt-5 flex items-center justify-end gap-2">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg border border-stone-700 px-3 py-2 text-sm text-stone-300 hover:bg-stone-900"
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              disabled={!canBegin}
              onClick={begin}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-200 px-4 py-2 text-sm font-medium text-stone-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:bg-stone-800 disabled:text-stone-500"
            >
              <Sparkles className="size-4" aria-hidden="true" />
              Begin story
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MobileToolsSheet({
  open,
  activeTool,
  onActiveToolChange,
  onClose,
  characters,
  draft,
  creating,
  uploadingId,
  onDraftChange,
  onDraftPortrait,
  onCreateCharacter,
  onLocalCharacterChange,
  onSaveCharacter,
  onPortraitFile,
  onClearPortrait,
  onDeleteCharacter,
  settings,
  setSettings,
  localTextStatus,
  clearingLocalData,
  onClearLocalData,
}: {
  open: boolean;
  activeTool: MobileTool;
  onActiveToolChange: (tool: MobileTool) => void;
  onClose: () => void;
  characters: StoryCharacter[];
  draft: CharacterDraft;
  creating: boolean;
  uploadingId: string;
  onDraftChange: (updater: CharacterDraft | ((current: CharacterDraft) => CharacterDraft)) => void;
  onDraftPortrait: (file: File) => void;
  onCreateCharacter: () => void;
  onLocalCharacterChange: (
    characterId: string,
    updates: Partial<Pick<StoryCharacter, "name" | "details">>,
  ) => void;
  onSaveCharacter: (character: StoryCharacter) => void;
  onPortraitFile: (characterId: string, file: File) => void;
  onClearPortrait: (characterId: string) => void;
  onDeleteCharacter: (characterId: string) => void;
  settings: StorySettings;
  setSettings: Dispatch<SetStateAction<StorySettings>>;
  localTextStatus: LocalTextStatus | null;
  clearingLocalData: boolean;
  onClearLocalData: () => void;
}) {
  if (!open) {
    return null;
  }

  const tools: Array<{ value: MobileTool; label: string }> = [
    { value: "characters", label: "Chars" },
    { value: "story", label: "Story" },
    { value: "images", label: "Images" },
    { value: "data", label: "Data" },
  ];

  return (
    <div className="fixed inset-0 z-30 lg:hidden">
      <button
        type="button"
        aria-label="Close story tools"
        onClick={onClose}
        className="absolute inset-0 bg-stone-950/70"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Story tools"
        className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-2xl border border-stone-700 bg-[#130d09] shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-800 px-4 py-3">
          <PanelTitle icon={Settings2} title="Tools" />
          <button
            type="button"
            aria-label="Close story tools"
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded border border-stone-800 text-stone-400 hover:bg-stone-900 hover:text-stone-100"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="grid shrink-0 grid-cols-4 gap-1 border-b border-stone-800 bg-stone-950/40 p-2">
          {tools.map((tool) => {
            const selected = tool.value === activeTool;
            return (
              <button
                key={tool.value}
                type="button"
                aria-pressed={selected}
                onClick={() => onActiveToolChange(tool.value)}
                className={cn(
                  "h-10 rounded text-sm text-stone-400 hover:bg-stone-900",
                  selected && "bg-stone-800 text-stone-100",
                )}
              >
                {tool.label}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {activeTool === "characters" && (
            <CharacterPanel
              characters={characters}
              draft={draft}
              creating={creating}
              uploadingId={uploadingId}
              onDraftChange={onDraftChange}
              onDraftPortrait={onDraftPortrait}
              onCreate={onCreateCharacter}
              onLocalChange={onLocalCharacterChange}
              onSave={onSaveCharacter}
              onPortraitFile={onPortraitFile}
              onClearPortrait={onClearPortrait}
              onDelete={onDeleteCharacter}
              compact
            />
          )}

          {activeTool === "story" && (
            <div className="space-y-6">
              <TextModelPanel
                settings={settings}
                setSettings={setSettings}
                localTextStatus={localTextStatus}
                compact
              />
              <StorySettingsPanel settings={settings} setSettings={setSettings} compact />
            </div>
          )}

          {activeTool === "images" && (
            <ImageSettingsPanel settings={settings} setSettings={setSettings} compact />
          )}

          {activeTool === "data" && (
            <LocalDataPanel clearing={clearingLocalData} onClear={onClearLocalData} compact />
          )}
        </div>
      </section>
    </div>
  );
}

function MobileChatBar({
  chats,
  selectedChatId,
  disabled,
  onSelect,
  onDelete,
}: {
  chats: StoryChatSummary[];
  selectedChatId: string;
  disabled: boolean;
  onSelect: (chatId: string) => void;
  onDelete: (chatId: string) => void;
}) {
  if (!chats.length) {
    return null;
  }

  const selectedChat = chats.find((chat) => chat.id === selectedChatId);

  return (
    <div className="flex items-center gap-2 border-b border-stone-800 py-3 lg:hidden">
      <select
        id="mobile-chat-select"
        name="mobile-chat-select"
        value={selectedChatId}
        onChange={(event) => onSelect(event.target.value)}
        disabled={disabled}
        className="min-w-0 flex-1 rounded border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-200 outline-none focus:border-amber-300"
      >
        {chats.map((chat) => (
          <option key={chat.id} value={chat.id}>
            {chat.title}
          </option>
        ))}
      </select>
      {selectedChat && (
        <DeleteChatDialog chat={selectedChat} onConfirm={() => onDelete(selectedChat.id)}>
          <button
            type="button"
            aria-label="Delete current story"
            className="flex size-10 items-center justify-center rounded border border-stone-800 text-stone-400 hover:bg-stone-900 hover:text-red-200"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </DeleteChatDialog>
      )}
    </div>
  );
}

function ChatLibrary({
  chats,
  selectedChatId,
  loading,
  onCreate,
  onSelect,
  onDelete,
}: {
  chats: StoryChatSummary[];
  selectedChatId: string;
  loading: boolean;
  onCreate: () => void;
  onSelect: (chatId: string) => void;
  onDelete: (chatId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <PanelTitle icon={Library} title="Chats" />
        <button
          type="button"
          aria-label="Create new story"
          onClick={onCreate}
          className="flex size-8 items-center justify-center rounded border border-stone-800 text-stone-300 hover:bg-stone-900"
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          <div className="h-16 rounded border border-stone-800 bg-stone-950" />
          <div className="h-16 rounded border border-stone-800 bg-stone-950" />
        </div>
      ) : (
        <div className="space-y-2">
          {chats.map((chat) => {
            const selected = chat.id === selectedChatId;
            return (
              <div
                key={chat.id}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_auto] items-stretch rounded border border-stone-800 bg-stone-950/80",
                  selected && "border-amber-200/70 bg-stone-900/70",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(chat.id)}
                  className="min-w-0 px-3 py-2 text-left"
                >
                  <span className="block truncate text-sm font-medium text-stone-200">
                    {chat.title}
                  </span>
                  <span className="mt-1 block truncate text-xs tabular-nums text-stone-500">
                    {chat.messageCount} {chat.messageCount === 1 ? "message" : "messages"} ·{" "}
                    {formatChatDate(chat.updatedAt)}
                  </span>
                  {chat.lastMessagePreview && (
                    <span className="mt-1 block truncate text-xs text-stone-600">
                      {chat.lastMessagePreview}
                    </span>
                  )}
                </button>
                <DeleteChatDialog chat={chat} onConfirm={() => onDelete(chat.id)}>
                  <button
                    type="button"
                    aria-label={`Delete ${chat.title}`}
                    className="flex w-10 items-center justify-center rounded-r text-stone-500 hover:bg-stone-900 hover:text-red-200"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </DeleteChatDialog>
              </div>
            );
          })}

          {!chats.length && (
            <button
              type="button"
              onClick={onCreate}
              className="w-full rounded border border-stone-800 bg-stone-950 px-3 py-4 text-left text-sm text-stone-400 hover:bg-stone-900"
            >
              Start a story
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CharacterPanel({
  characters,
  draft,
  creating,
  uploadingId,
  onDraftChange,
  onDraftPortrait,
  onCreate,
  onLocalChange,
  onSave,
  onPortraitFile,
  onClearPortrait,
  onDelete,
  compact = false,
}: {
  characters: StoryCharacter[];
  draft: CharacterDraft;
  creating: boolean;
  uploadingId: string;
  onDraftChange: (updater: CharacterDraft | ((current: CharacterDraft) => CharacterDraft)) => void;
  onDraftPortrait: (file: File) => void;
  onCreate: () => void;
  onLocalChange: (
    characterId: string,
    updates: Partial<Pick<StoryCharacter, "name" | "details">>,
  ) => void;
  onSave: (character: StoryCharacter) => void;
  onPortraitFile: (characterId: string, file: File) => void;
  onClearPortrait: (characterId: string) => void;
  onDelete: (characterId: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={cn("space-y-3", compact ? "" : "border-t border-stone-800 pt-6")}>
      <PanelTitle icon={UserRound} title="Characters" />

      <div className="space-y-3 rounded border border-stone-800 bg-stone-950/70 p-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase text-stone-500">Name</span>
          <input
            id="new-character-name"
            name="new-character-name"
            value={draft.name}
            onChange={(event) =>
              onDraftChange((current) => ({ ...current, name: event.target.value }))
            }
            className="w-full rounded border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-200 outline-none focus:border-amber-300"
            placeholder="Valerie Maroto"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase text-stone-500">Details</span>
          <textarea
            id="new-character-details"
            name="new-character-details"
            value={draft.details}
            onChange={(event) =>
              onDraftChange((current) => ({ ...current, details: event.target.value }))
            }
            rows={3}
            className="w-full resize-none rounded border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-200 outline-none focus:border-amber-300"
            placeholder="Short black hair, tomboy, dry humor..."
          />
        </label>

        {draft.portrait && (
          <div className="flex items-center gap-2 rounded border border-stone-800 bg-stone-950 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={draft.portrait.url} alt="" className="size-12 rounded object-cover" />
            <span className="min-w-0 flex-1 truncate text-xs text-stone-400">
              {draft.portrait.name}
            </span>
            <button
              type="button"
              aria-label="Remove draft character picture"
              onClick={() => onDraftChange((current) => ({ ...current, portrait: undefined }))}
              className="flex size-7 items-center justify-center rounded text-stone-500 hover:bg-stone-900 hover:text-stone-100"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            id="new-character-picture"
            name="new-character-picture"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) {
                onDraftPortrait(file);
              }
              event.currentTarget.value = "";
            }}
          />
          <label
            htmlFor="new-character-picture"
            className="inline-flex h-9 cursor-pointer items-center gap-2 rounded border border-stone-700 px-3 text-sm text-stone-300 hover:bg-stone-900"
          >
            {uploadingId === "draft" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <ImagePlus className="size-4" aria-hidden="true" />
            )}
            Picture
          </label>

          <button
            type="button"
            onClick={onCreate}
            disabled={!draft.name.trim() || creating || uploadingId === "draft"}
            className="ml-auto inline-flex h-9 items-center gap-2 rounded bg-amber-200 px-3 text-sm font-medium text-stone-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:bg-stone-800 disabled:text-stone-500"
          >
            {creating ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="size-4" aria-hidden="true" />
            )}
            Add
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {characters.map((character) => {
          const pictureInputId = `character-picture-${character.id}`;

          return (
            <div
              key={character.id}
              className="space-y-2 rounded border border-stone-800 bg-stone-950/70 p-3"
            >
              <div className="grid grid-cols-[48px_minmax(0,1fr)_auto] gap-3">
                <div className="flex size-12 items-center justify-center overflow-hidden rounded border border-stone-800 bg-stone-900 text-stone-500">
                  {character.portrait ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={character.portrait.url}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    <UserRound className="size-5" aria-hidden="true" />
                  )}
                </div>

                <div className="min-w-0 space-y-2">
                  <input
                    value={character.name}
                    onChange={(event) =>
                      onLocalChange(character.id, { name: event.target.value })
                    }
                    onBlur={() => onSave(character)}
                    className="w-full rounded border border-stone-800 bg-stone-950 px-2 py-1.5 text-sm font-medium text-stone-200 outline-none focus:border-amber-300"
                  />
                  <textarea
                    value={character.details}
                    onChange={(event) =>
                      onLocalChange(character.id, { details: event.target.value })
                    }
                    onBlur={() => onSave(character)}
                    rows={3}
                    className="w-full resize-none rounded border border-stone-800 bg-stone-950 px-2 py-1.5 text-xs text-stone-300 outline-none focus:border-amber-300"
                    placeholder="Details the narrator should preserve..."
                  />
                </div>

                <DeleteCharacterDialog characterName={character.name} onConfirm={() => onDelete(character.id)}>
                  <button
                    type="button"
                    aria-label={`Delete ${character.name}`}
                    className="flex size-8 items-center justify-center rounded text-stone-500 hover:bg-stone-900 hover:text-red-200"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </DeleteCharacterDialog>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id={pictureInputId}
                  name={pictureInputId}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) {
                      onPortraitFile(character.id, file);
                    }
                    event.currentTarget.value = "";
                  }}
                />
                <label
                  htmlFor={pictureInputId}
                  className="inline-flex h-8 cursor-pointer items-center gap-2 rounded border border-stone-800 px-2 text-xs text-stone-400 hover:bg-stone-900 hover:text-stone-200"
                >
                  {uploadingId === character.id ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <ImagePlus className="size-3.5" aria-hidden="true" />
                  )}
                  Photo
                </label>
                {character.portrait && (
                  <button
                    type="button"
                    onClick={() => onClearPortrait(character.id)}
                    className="h-8 rounded border border-stone-800 px-2 text-xs text-stone-500 hover:bg-stone-900 hover:text-stone-200"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {!characters.length && (
          <p className="rounded border border-dashed border-stone-800 px-3 py-4 text-sm text-stone-500">
            Saved characters will appear here.
          </p>
        )}
      </div>
    </div>
  );
}

function DeleteCharacterDialog({
  characterName,
  onConfirm,
  children,
}: {
  characterName: string;
  onConfirm: () => void;
  children: ReactNode;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>{children}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-stone-950/80" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(calc(100vw-2rem),420px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-stone-700 bg-[#130d09] p-5 shadow-xl">
          <AlertDialog.Title className="text-balance text-base font-semibold text-stone-100">
            Delete this character?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-pretty text-sm text-stone-400">
            {characterName || "This character"} will be removed from this story.
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <button
                type="button"
                className="rounded border border-stone-700 px-3 py-2 text-sm text-stone-300 hover:bg-stone-900"
              >
                Cancel
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                type="button"
                onClick={onConfirm}
                className="rounded bg-red-300 px-3 py-2 text-sm font-medium text-red-950 hover:bg-red-200"
              >
                Delete
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

function TextModelPanel({
  settings,
  setSettings,
  localTextStatus,
  compact = false,
}: {
  settings: StorySettings;
  setSettings: Dispatch<SetStateAction<StorySettings>>;
  localTextStatus: LocalTextStatus | null;
  compact?: boolean;
}) {
  const idPrefix = compact ? "mobile" : "desktop";
  const selectedMissing =
    localTextStatus?.ok && !localTextStatus.installedModels.includes(settings.localTextModel);

  return (
    <div className={cn("space-y-3", compact ? "" : "border-t border-stone-800 pt-6")}>
      <PanelTitle icon={Cpu} title="Text Model" />
      <div className="space-y-2">
        <span className="block text-xs font-medium uppercase text-stone-500">Provider</span>
        <Segmented<TextProvider>
          value={settings.textProvider}
          options={[
            { value: "local", label: "Local" },
            { value: "openrouter", label: "OpenRouter" },
          ]}
          onChange={(textProvider) =>
            setSettings((current) => ({ ...current, textProvider }))
          }
        />
      </div>
      {settings.textProvider === "local" ? (
        <div className="space-y-2">
          <span className="block text-xs font-medium uppercase text-stone-500">
            Gemma 4 QAT (Q4)
          </span>
          <select
            id={`${idPrefix}-local-text-model`}
            name={`${idPrefix}-local-text-model`}
            value={settings.localTextModel}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                localTextModel: event.target.value as LocalTextModelId,
              }))
            }
            className="w-full rounded border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-200 outline-none focus:border-amber-300"
          >
            {LOCAL_TEXT_MODELS.map((model) => {
              const missing =
                localTextStatus?.ok && !localTextStatus.installedModels.includes(model.id);
              return (
                <option key={model.id} value={model.id}>
                  {`${model.label} · ${model.ram} RAM${missing ? ` · needs ${model.size} download` : ""}`}
                </option>
              );
            })}
          </select>
          {localTextStatus && !localTextStatus.ok && (
            <p className="text-xs text-amber-200/80">
              Ollama is not reachable. Start the Ollama app, then reload this page.
            </p>
          )}
          {selectedMissing && (
            <p className="text-xs text-amber-200/80">
              Install with{" "}
              <code className="rounded bg-stone-900 px-1 py-0.5 text-amber-100">
                ollama pull {settings.localTextModel}
              </code>
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-stone-500">
          Uses OPENROUTER_API_KEY and OPENROUTER_MODEL from .env.server.
        </p>
      )}
    </div>
  );
}

function StorySettingsPanel({
  settings,
  setSettings,
  compact = false,
}: {
  settings: StorySettings;
  setSettings: Dispatch<SetStateAction<StorySettings>>;
  compact?: boolean;
}) {
  const idPrefix = compact ? "mobile" : "desktop";

  return (
    <div className={cn("space-y-4", compact ? "" : "border-t border-stone-800 pt-6")}>
      <PanelTitle icon={Settings2} title="Story" />
      <label className="block">
        <span className="mb-2 block text-xs font-medium uppercase text-stone-500">
          World
        </span>
        <textarea
          id={`${idPrefix}-story-world`}
          name={`${idPrefix}-story-world`}
          value={settings.world}
          onChange={(event) =>
            setSettings((current) => ({ ...current, world: event.target.value }))
          }
          rows={compact ? 4 : 5}
          className="w-full resize-none rounded border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-200 outline-none focus:border-amber-300"
        />
      </label>
      <label className="block">
        <span className="mb-2 block text-xs font-medium uppercase text-stone-500">
          Style
        </span>
        <textarea
          id={`${idPrefix}-story-style`}
          name={`${idPrefix}-story-style`}
          value={settings.style}
          onChange={(event) =>
            setSettings((current) => ({ ...current, style: event.target.value }))
          }
          rows={compact ? 3 : 4}
          className="w-full resize-none rounded border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-200 outline-none focus:border-amber-300"
        />
      </label>
    </div>
  );
}

function ImageSettingsPanel({
  settings,
  setSettings,
  compact = false,
}: {
  settings: StorySettings;
  setSettings: Dispatch<SetStateAction<StorySettings>>;
  compact?: boolean;
}) {
  const idPrefix = compact ? "mobile" : "desktop";

  return (
    <div className={cn("space-y-3", compact ? "" : "border-t border-stone-800 pt-6")}>
      <PanelTitle icon={Aperture} title="Images" />
      <div className="space-y-2">
        <span className="block text-xs font-medium uppercase text-stone-500">Backend</span>
        <Segmented<ImageBackend>
          value={settings.imageBackend}
          options={[
            { value: "mflux-hs", label: "MFLUX 4B" },
            { value: "sdnq-hs", label: "SDNQ HS" },
          ]}
          onChange={(imageBackend) =>
            setSettings((current) => ({
              ...current,
              imageBackend,
            }))
          }
        />
      </div>
      <div className="space-y-2">
        <span className="block text-xs font-medium uppercase text-stone-500">Size</span>
        <Segmented<ImageMode>
          value={settings.imageMode}
          options={[
            { value: "fast", label: "1024" },
            { value: "slow", label: "2048" },
          ]}
          onChange={(imageMode) => setSettings((current) => ({ ...current, imageMode }))}
        />
      </div>
      <div className="space-y-2">
        <span className="block text-xs font-medium uppercase text-stone-500">Aspect</span>
        <Segmented<AspectPreset>
          value={settings.aspect}
          options={[
            { value: "square", label: "Square" },
            { value: "portrait", label: "Portrait" },
            { value: "landscape", label: "Landscape" },
          ]}
          onChange={(aspect) => setSettings((current) => ({ ...current, aspect }))}
        />
      </div>
      <label className="flex items-center justify-between rounded border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-300">
        Auto images
        <input
          id={`${idPrefix}-auto-images`}
          name={`${idPrefix}-auto-images`}
          type="checkbox"
          checked={settings.autoImages}
          onChange={(event) =>
            setSettings((current) => ({ ...current, autoImages: event.target.checked }))
          }
          className="size-4 accent-amber-200"
        />
      </label>
    </div>
  );
}

function LocalDataPanel({
  clearing,
  onClear,
  compact = false,
}: {
  clearing: boolean;
  onClear: () => void;
  compact?: boolean;
}) {
  return (
    <div className={cn("space-y-3", compact ? "" : "border-t border-stone-800 pt-6")}>
      <PanelTitle icon={Trash2} title="Local Data" />
      <ClearLocalDataDialog onConfirm={onClear}>
        <button
          type="button"
          disabled={clearing}
          className="inline-flex w-full items-center justify-center gap-2 rounded border border-red-900/80 bg-red-950/20 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:border-stone-800 disabled:text-stone-600"
        >
          {clearing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Trash2 className="size-4" aria-hidden="true" />
          )}
          Clear all local data
        </button>
      </ClearLocalDataDialog>
    </div>
  );
}

function ClearLocalDataDialog({
  onConfirm,
  children,
}: {
  onConfirm: () => void;
  children: ReactNode;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>{children}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-stone-950/80" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(calc(100vw-2rem),440px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-red-900/80 bg-[#130d09] p-5 shadow-xl">
          <AlertDialog.Title className="text-balance text-base font-semibold text-red-100">
            Permanently clear this app?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-pretty text-sm text-stone-400">
            This deletes all local stories, messages, characters, uploaded photos, generated images,
            and temporary reference files from this Mac.
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <button
                type="button"
                className="rounded border border-stone-700 px-3 py-2 text-sm text-stone-300 hover:bg-stone-900"
              >
                Cancel
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                type="button"
                onClick={onConfirm}
                className="rounded bg-red-300 px-3 py-2 text-sm font-medium text-red-950 hover:bg-red-200"
              >
                Delete everything
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

function DeleteChatDialog({
  chat,
  onConfirm,
  children,
}: {
  chat: StoryChatSummary;
  onConfirm: () => void;
  children: ReactNode;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>{children}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-stone-950/80" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(calc(100vw-2rem),420px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-stone-700 bg-[#130d09] p-5 shadow-xl">
          <AlertDialog.Title className="text-balance text-base font-semibold text-stone-100">
            Delete this story?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-pretty text-sm text-stone-400">
            {chat.title} and its saved messages will be removed from the local database.
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <button
                type="button"
                className="rounded border border-stone-700 px-3 py-2 text-sm text-stone-300 hover:bg-stone-900"
              >
                Cancel
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                type="button"
                onClick={onConfirm}
                className="rounded bg-red-300 px-3 py-2 text-sm font-medium text-red-950 hover:bg-red-200"
              >
                Delete
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

function StorySkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="h-4 w-11/12 rounded bg-stone-900" />
        <div className="h-4 w-10/12 rounded bg-stone-900" />
        <div className="h-4 w-2/3 rounded bg-stone-900" />
      </div>
      <div className="ml-auto h-20 w-2/3 rounded border border-stone-800 bg-stone-950" />
    </div>
  );
}

function AttachmentStrip({
  attachments,
  className,
  onRemove,
}: {
  attachments: Attachment[];
  className?: string;
  onRemove?: (id: string) => void;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="relative flex items-center gap-2 rounded border border-stone-700 bg-stone-950/80 p-1 pr-2 text-xs text-stone-400"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={attachment.url} alt="" className="size-12 rounded object-cover" />
          <span className="max-w-36 truncate">{attachment.name}</span>
          {onRemove && (
            <button
              type="button"
              aria-label={`Remove ${attachment.name}`}
              onClick={() => onRemove(attachment.id)}
              className="flex size-6 items-center justify-center rounded text-stone-400 hover:bg-stone-800 hover:text-stone-100"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function ImageBeat({
  message,
  status,
  onRetry,
}: {
  message: StoryMessage;
  status?: "loading" | "error";
  onRetry: () => void;
}) {
  const isLoading = status === "loading";
  const isError = status === "error";
  const [promptExpanded, setPromptExpanded] = useState(false);

  if (message.generatedImage) {
    return (
      <figure className="mt-6 overflow-hidden rounded-xl border border-stone-800 bg-stone-950">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={message.generatedImage.url}
          alt={message.generatedImage.prompt}
          className="max-h-[720px] w-full object-contain"
        />
        <figcaption className="border-t border-stone-800 px-3 py-2 font-sans text-xs text-stone-500">
          <div className="flex items-start justify-between gap-3">
            <p className={cn("min-w-0 leading-5", promptExpanded ? "" : "line-clamp-2")}>
              {message.generatedImage.prompt}
            </p>
            <span className="shrink-0 pt-0.5 tabular-nums">
              {message.generatedImage.backend ? `${message.generatedImage.backend} · ` : ""}
              {message.generatedImage.width}×{message.generatedImage.height}
            </span>
          </div>
          {message.generatedImage.prompt.length > 120 && (
            <button
              type="button"
              onClick={() => setPromptExpanded((value) => !value)}
              className="mt-1 text-xs text-amber-200 hover:text-amber-100"
            >
              {promptExpanded ? "Show less" : "See more"}
            </button>
          )}
        </figcaption>
      </figure>
    );
  }

  const pendingPrompt = message.imageRequest?.prompt;

  return (
    <div className="mt-6 rounded border border-stone-800 bg-stone-950 px-4 py-3 font-sans text-sm text-stone-400">
      <div className="flex items-center gap-3">
        {isError ? (
          <ImagePlus className="size-4 text-red-300" aria-hidden="true" />
        ) : isLoading ? (
          <Loader2 className="size-4 animate-spin text-amber-200" aria-hidden="true" />
        ) : (
          <ImagePlus className="size-4 text-amber-200" aria-hidden="true" />
        )}
        <span>
          {isError
            ? "Image tool failed."
            : isLoading
              ? "Generating image beat..."
              : "Image tool requested."}
        </span>
        {!isLoading && (
          <button
            type="button"
            onClick={onRetry}
            className="ml-auto rounded border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900"
          >
            {isError ? "Retry" : "Generate"}
          </button>
        )}
      </div>
      {pendingPrompt && (
        <div className="mt-2">
          <p className={cn("text-xs leading-5 text-stone-600", promptExpanded ? "" : "line-clamp-2")}>
            {pendingPrompt}
          </p>
          {pendingPrompt.length > 120 && (
            <button
              type="button"
              onClick={() => setPromptExpanded((value) => !value)}
              className="mt-1 text-xs text-amber-200 hover:text-amber-100"
            >
              {promptExpanded ? "Show less" : "See more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PanelTitle({
  icon: Icon,
  title,
}: {
  icon: typeof Sparkles;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-stone-300">
      <Icon className="size-4 text-amber-200" aria-hidden="true" />
      {title}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div
      className={cn(
        "grid gap-1 rounded border border-stone-800 bg-stone-950 p-1",
        options.length === 2 ? "grid-cols-2" : "grid-cols-3",
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs text-stone-400 hover:bg-stone-900",
              selected && "bg-stone-800 text-stone-100",
            )}
          >
            {selected && <Check className="size-3" aria-hidden="true" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
