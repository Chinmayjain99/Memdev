export type MemoryCaptureType = 'text' | 'url';

export type Memory = {
  id: string;
  captureType: MemoryCaptureType;
  title: string | null;
  selectedText: string | null;
  manualNote: string | null;
  sourceUrl: string | null;
  pageTitle: string | null;
  domain: string | null;
  tags: string[];
  topic: string | null;
  language: string | null;
  isCode: boolean;
  codeLanguage: string | null;
  clientCreatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastRevisitedAt: Date | null;
  revisitCount: number;
  version: number;
};

export type PageCursor = { createdAt: string; id: string };
export type MemoryPage = { memories: Memory[]; nextCursor: string | null; hasMore: boolean };
