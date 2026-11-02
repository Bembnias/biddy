// Publiczne API magazynu plików (F-12): adapter OBJECT_STORAGE (S3: R2 albo RustFS).
export {
  OBJECT_STORAGE,
  type ObjectStorage,
  type PresignPutOptions,
  S3ObjectStorage,
  type StoredObject,
} from './object-storage.js';
export { StorageModule } from './storage.module.js';
