export interface Note {
  id: string;
  collectionId: string;
  text: string;
  created: number;
  isLocal?: boolean;
}

export interface Collection {
  id: string;
  name: string;
  created: number;
  isLocal?: boolean;
}

export interface User {
  id: string;
  username: string;
  avatar?: string;
  apiToken?: string;
  apiUrl?: string;
}

export interface ApiError {
  error: string;
}

export enum ViewState {
  LOADING = 'LOADING',
  EMPTY = 'EMPTY',
  DATA = 'DATA',
  ERROR = 'ERROR'
}