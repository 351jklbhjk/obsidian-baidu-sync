import { Modal, Platform, Setting, TFile, requestUrl } from "obsidian";
import BaiduSyncPlugin from "./main";
import { SyncEngine } from "./sync/engine";
import { SyncFilter } from "./sync/filter";
import { SyncLogModal } from "./ui/logModal";
import { md5 } from "./crypto/md5";
import { decryptData, encryptData, getCrypto, isEncrypted } from "./crypto/e2ee";
import { buildMultipartFormData } from "./baidu/multipart";
// @ts-ignore - plain JavaScript module for the native Baidu API reconciler
import { createNativeSync } from "./native-sync.js";

const nativeSync = createNativeSync({
  requestUrl,
  md5,
  encryptData,
  decryptData,
  isEncrypted,
  buildMultipartFormData,
  crypto: getCrypto,
  Modal,
  Setting,
  Platform,
  schedule: (fn: () => void, ms: number) => window.setTimeout(fn, ms),
});

nativeSync.install({
  SyncEngine,
  BaiduSyncPlugin,
  SyncLogModal,
  SyncFilter,
  TFile,
});

export default BaiduSyncPlugin;
