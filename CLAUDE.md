# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run setup        # Install deps + generate Prisma client + run migrations
npm run dev          # Start dev server (Turbopack) at http://localhost:3000
npm run dev:daemon   # Start dev server in background, logs to logs.txt
npm run build        # Production build
npm test             # Run Vitest tests (watch mode)
npm run lint         # ESLint
npm run db:reset     # Force DB reset and re-migrate
```

Run a single test file: `npx vitest run src/components/chat/__tests__/`

All run scripts prepend `NODE_OPTIONS='--require ./node-compat.cjs'` to fix a Node.js 25+ issue where SSR breaks because Node exposes `localStorage`/`sessionStorage` globals. See `node-compat.cjs` for details.

## Environment

`.env` requires `ANTHROPIC_API_KEY`. Without it, a `MockLanguageModel` (`src/lib/provider.ts`) returns static component code instead of calling Claude. The mock simulates the same tool-call flow so the UI still works end-to-end.

The real model is `claude-haiku-4-5` (set in `src/lib/provider.ts:8`).

## Architecture

### Core request flow

1. User sends a message → `ChatContext` (`src/lib/contexts/chat-context.tsx`) calls `POST /api/chat` via Vercel AI SDK's `useChat`
2. `src/app/api/chat/route.ts` injects the system prompt, reconstructs a `VirtualFileSystem` from the serialized `files` body param, then calls `streamText` with two tools
3. Claude calls tools to populate the VFS; tool results stream back to the client
4. `FileSystemContext` (`src/lib/contexts/file-system-context.tsx`) receives tool calls via `onToolCall` and mutates the in-memory VFS
5. `PreviewFrame` (`src/components/preview/PreviewFrame.tsx`) re-renders on every VFS change via `refreshTrigger`

### Virtual File System (`src/lib/file-system.ts`)

All generated files live in memory — nothing is written to disk. The VFS is a `Map<string, FileNode>` tree. It serializes to a flat `Record<string, FileNode>` stored as JSON in the `Project.data` SQLite column. The `serialize()` / `deserializeFromNodes()` methods handle the round-trip.

### AI tools (`src/lib/tools/`)

- `str-replace.ts` — `str_replace_editor` tool: creates files, replaces strings, inserts lines, views files
- `file-manager.ts` — `file_manager` tool: creates/deletes files/directories

### Preview pipeline (`src/lib/transform/jsx-transformer.ts`)

`createImportMap` iterates VFS files, transpiles JSX/TSX via `@babel/standalone`, creates blob URLs, and builds an ES module import map. Third-party packages are resolved through `esm.sh`. The resulting HTML is injected into an `<iframe srcdoc>` in `PreviewFrame`. Entry point lookup order: `/App.jsx` → `/App.tsx` → `/index.jsx` → `/index.tsx` → `/src/App.jsx` → first `.jsx/.tsx` found.

### State management

Two React contexts wrap the app at the project route (`src/app/[projectId]/page.tsx`):
- `FileSystemProvider` — owns the `VirtualFileSystem` instance; exposes `handleToolCall` which routes tool calls to the correct VFS method
- `ChatProvider` — wraps Vercel AI SDK `useChat`; sends serialized VFS in every request body so the server can reconstruct it

### Auth

JWT sessions via JOSE (`src/lib/auth.ts`). Token stored in an HTTPOnly cookie (`auth-token`, 7-day expiry). `src/middleware.ts` protects routes. Anonymous use is allowed — projects are created without a `userId` and linked to a user on sign-up/sign-in via the anon-work tracker (`src/lib/anon-work-tracker.ts`).

### Database

Prisma + SQLite (`prisma/dev.db`). Two models: `User` (email + bcrypt password) and `Project` (`messages` JSON, `data` JSON for the VFS). Prisma client is generated to `src/generated/prisma/`.

### System prompt

`src/lib/prompts/generation.tsx` — controls how Claude generates components. Modify here to change AI behavior.
