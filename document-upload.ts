import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { HttpClient, HttpClientModule, HttpEventType } from '@angular/common/http';
import { API_BASE_URL } from '../../api-base';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';

interface UploadFile {
  file: File;
  id: string;
}

interface DocumentType {
  id: number;
  name: string;
}

interface DhrpEntry {
  company: string;
  bse_code?: string;
  upload_date?: string;
  uploader_name?: string;
  promoter?: string;
  pdf_filename?: string;
  status?: string;
  toc_verified?: boolean;
  document_type_name?: string;
}

// --- Persistent Processing State ---
interface ProcessingState {
  processingMap: Record<string, boolean>;
  newDocuments: DhrpEntry[];
}

@Component({
  selector: 'app-document-upload',
  standalone: true,
  imports: [CommonModule, HttpClientModule],
  templateUrl: './document-upload.html',
  styleUrls: ['./document-upload.css'],
})
export class DocumentUpload implements OnInit {
      // Helper: get files currently uploading (local state, not yet in backend)
      getLocallyUploadingFiles(): UploadFile[] {
        // Always show files in this.files() until backend confirms upload (removed from files() after confirmation)
        return this.files();
      }
    // Helper: get files that are still uploading (progress < 100)
    getUploadingDocs(): DhrpEntry[] {
      const docs = this.newDocuments();
      return docs.filter(doc => {
        const base = this.baseFromFilename(doc.pdf_filename);
        // If progress is tracked and < 100, it's uploading
        if (this.progressMap && base in this.progressMap) {
          return this.progressMap[base] < 100;
        }
        return false;
      });
    }

    // Helper: get docs that are ready to process (progress 100 or not tracked, and status is 'New' or 'Processing')
    getReadyToProcessDocs(): DhrpEntry[] {
      const docs = this.newDocuments();
      return docs.filter(doc => {
        const base = this.baseFromFilename(doc.pdf_filename);
        // Only show if status is 'New' or 'Processing'
        const status = (doc.status || '').toLowerCase();
        if (status !== 'new' && status !== 'processing') return false;
        if (this.progressMap && base in this.progressMap) {
          return this.progressMap[base] >= 100;
        }
        // If not tracked, assume ready
        return true;
      });
    }
  // Persistent upload state key
  private readonly UPLOAD_STATE_KEY = 'documentUploadState';

  // Files and form fields
  files = signal<UploadFile[]>([]);
  companyName = signal('');
  uploadDate = signal(new Date().toISOString().split('T')[0]);
  uploaderName = signal('');
  documentTypeId = signal<number | null>(null);

  // Document types list
  documentTypes: DocumentType[] = [];
  isLoadingTypes = false;
  typesError = '';

  // DHRP entries needing processing (and other entries)
  newDocuments = signal<DhrpEntry[]>([]);
  isLoadingNewDocs = signal(false);
  loadDocsError = signal('');

  // processing state map (base -> boolean)
  processingMap: Record<string, boolean> = {};
  processMessage = signal('');

  // Upload state
  uploadCompleted = signal(false);
  uploadInProgress = signal(false);
  uploadMessage = signal('');
  uploadErrors: string[] = [];
  progressMap: Record<string, number> = {};
  uploadElapsedSeconds = signal(0);
  private uploadTimerInterval: any;

  // Stores uploaded entries after successful upload
  uploadedEntries: DhrpEntry[] = [];

  // Backend endpoints
  private readonly GET_TYPES_ENDPOINT = `${API_BASE_URL}/document-types`;
  private readonly UPLOAD_ENDPOINT = `${API_BASE_URL}/upload`;
  private readonly GET_DHRPS_ENDPOINT = `${API_BASE_URL}/get_all_dhrps`;
  private readonly PROCESS_ENDPOINT_BASE = `${API_BASE_URL}/process`; // POST /process/{base}

  constructor(private router: Router, private http: HttpClient) {}

  ngOnInit(): void {
    this.restoreProcessingState();
    this.loadDocumentTypes();
    this.loadNewDocuments();
    // Resume polling for any processing docs
    Object.keys(this.processingMap).forEach(base => {
      if (this.processingMap[base]) {
        this.pollProcessingStatus(base);
      }
    });
  }

  // Load available document types for dropdown
  loadDocumentTypes(): void {
    this.isLoadingTypes = true;
    this.typesError = '';
    this.http
      .get<{ success?: boolean; document_types?: DocumentType[] }>(this.GET_TYPES_ENDPOINT)
      .pipe(
        catchError((err) => {
          this.typesError = 'Failed to load document types';
          this.isLoadingTypes = false;
          return of(null);
        })
      )
      .subscribe((res) => {
        if (res && Array.isArray(res.document_types)) {
          this.documentTypes = res.document_types;
        } else {
          this.documentTypes = [];
        }
        this.isLoadingTypes = false;
      });
  }

  // Load DHRP entries with status 'New'
  loadNewDocuments(): void {
    this.isLoadingNewDocs.set(true);
    this.loadDocsError.set('');
    this.http
      .get<DhrpEntry[]>(this.GET_DHRPS_ENDPOINT)
      .pipe(
        catchError((err) => {
          console.error('Failed to load DHRP entries', err);
          this.loadDocsError.set('Failed to load documents');
          this.isLoadingNewDocs.set(false);
          return of(null);
        })
      )
      .subscribe((res: any) => {
        if (Array.isArray(res)) {
          // Merge backend status with local processingMap, but only override to Processing if not completed
          const newOnes = res.filter((e: DhrpEntry) => (e.status ?? '').toLowerCase() === 'new' || (e.status ?? '').toLowerCase() === 'processing');
          const merged = newOnes.map((doc: DhrpEntry) => {
            const base = this.baseFromFilename(doc.pdf_filename);
            let status = doc.status;
            if (this.processingMap[base] && (!status || status.toLowerCase() !== 'completed')) {
              status = 'Processing';
            }
            return { ...doc, status };
          });
          this.newDocuments.set(merged);
        } else {
          this.newDocuments.set([]);
        }
        this.isLoadingNewDocs.set(false);
      });
  }

  // Navigation helpers
  cancel(): void {
    this.router.navigate(['/dashboard']);
  }

  viewMapper(): void {
    this.router.navigate(['/mapper']);
  }

  startProcessing(): void {
    const dtId = this.documentTypeId();
    if (dtId != null) {
      this.router.navigate(['/processing-status'], {
        state: { typeId: dtId }
      });
    } else {
      this.router.navigate(['/processing-status']);
    }
  }

  // Get selected document type name
  private getSelectedTypeName(): string | null {
    const dtId = this.documentTypeId();
    if (dtId != null) {
      const type = this.documentTypes.find(t => t.id === dtId);
      return type ? type.name : null;
    }
    return null;
  }

  // File handling
  handleFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const newFiles: UploadFile[] = Array.from(input.files).map((file) => ({
      file,
      id: Math.random().toString(36).substring(2, 9),
    }));

    this.files.set([...this.files(), ...newFiles]);
    input.value = '';
  }

  removeFile(id: string): void {
    this.files.set(this.files().filter((f) => f.id !== id));
    delete this.progressMap[id];
  }

  fileSizeMB(file: File): string {
    return `${(file.size / 1024 / 1024).toFixed(2)} MB`;
  }

  getProgress(id: string): number {
    return Math.round(this.progressMap[id] ?? 0);
  }

  // Validation
  canUpload(): boolean {
    return (
      this.files().length > 0 &&
      !!this.companyName().trim() &&
      !!this.uploaderName().trim() &&
      this.documentTypeId() !== null &&
      !this.uploadInProgress()
    );
  }

  // Upload workflow
  async handleUpload(): Promise<void> {
    if (!this.canUpload()) {
      this.uploadMessage.set('Please select files and fill Company, Uploader and Document Type.');
      return;
    }

    const toUpload = this.files();
    if (toUpload.length === 0) {
      this.uploadMessage.set('No files to upload.');
      return;
    }

    this.uploadInProgress.set(true);
    this.uploadMessage.set('');
    this.uploadErrors = [];
    this.uploadCompleted.set(false);
    this.uploadedEntries = []; // Reset uploadedEntries before upload
    this.uploadElapsedSeconds.set(0);

    // Start timer
    this.uploadTimerInterval = setInterval(() => {
      this.uploadElapsedSeconds.set(this.uploadElapsedSeconds() + 1);
    }, 1000);

    const selectedTypeName = this.getSelectedTypeName();

    // Set progress to 0 for all files before starting uploads
    for (const item of toUpload) {
      this.progressMap[item.id] = 0;
    }
    this.saveUploadState();
    for (const item of toUpload) {
      try {
        const entry = await this.uploadSingleFile(item, selectedTypeName);
        if (entry) {
          this.uploadedEntries.push(entry);
          this.addOrUpdateEntry(entry);
          // Only remove from files() if entry is ready to process (status 'new' or 'processing')
          const status = (entry.status || '').toLowerCase();
          if (status === 'new' || status === 'processing') {
            setTimeout(() => {
              this.files.set(this.files().filter(f => f.id !== item.id));
            }, 0);
          }
        }
      } catch (err: any) {
        const message = err?.message || 'Upload failed';
        this.uploadErrors.push(`${item.file.name}: ${message}`);
      }
    }

    this.uploadInProgress.set(false);
    // Stop timer
    if (this.uploadTimerInterval) {
      clearInterval(this.uploadTimerInterval);
    }

    if (this.uploadErrors.length === 0) {
      this.uploadCompleted.set(true);
      this.uploadMessage.set('All files uploaded successfully. You can now view and process them below.');
      // Do not clear files here; already removed after each upload
    }
  }

  private uploadSingleFile(item: UploadFile, selectedTypeName: string | null): Promise<DhrpEntry | undefined> {
    return new Promise((resolve, reject) => {
      const form = new FormData();

      form.append('company', this.companyName().trim());
      form.append('upload_date', this.uploadDate().trim());
      form.append('uploader_name', this.uploaderName().trim());
      const dt = this.documentTypeId();
      form.append('document_type_id', dt != null ? String(dt) : '');
      form.append('pdf', item.file, item.file.name);

      this.progressMap[item.id] = 0;
      this.saveUploadState();

      this.http
        .post(this.UPLOAD_ENDPOINT, form, {
          reportProgress: true,
          observe: 'events',
        })
        .pipe(catchError((err) => of(err)))
        .subscribe({
          next: (event: any) => {
            if (event && event.type === HttpEventType.UploadProgress) {
              const percent = event.total ? Math.round((100 * event.loaded) / event.total) : 0;
              this.progressMap[item.id] = percent;
              this.saveUploadState();
            } else if (event && event.type === HttpEventType.Response) {
              const body = event.body;
              if (body && body.success === false) {
                this.progressMap[item.id] = 0;
                reject(new Error(body.message || 'Server reported failure'));
                this.saveUploadState();
                return;
              }
              this.progressMap[item.id] = 100;
              this.saveUploadState();
              if (body && body.entry) {
                const entry = body.entry as DhrpEntry;
                // Include document type name with the entry
                if (selectedTypeName) {
                  entry.document_type_name = selectedTypeName;
                  // Store mapping in localStorage for persistence across page reloads
                  const base = this.baseFromFilename(entry.pdf_filename);
                  if (base) {
                    localStorage.setItem(`doc_type_${base}`, selectedTypeName);
                  }
                }
                resolve(entry);
                this.saveUploadState();
                return;
              }
              resolve(undefined);
              this.saveUploadState();
            } else if (event && event.status && event.status >= 400) {
              const message = event.error?.message || `HTTP ${event.status}`;
              this.progressMap[item.id] = 0;
              reject(new Error(message));
              this.saveUploadState();
            }
          },
          error: (err) => {
            this.progressMap[item.id] = 0;
            reject(err);
            this.saveUploadState();
          },
        });
    });
  }

  // Add or update an entry in the newDocuments list
  private addOrUpdateEntry(entry: DhrpEntry): void {
    const pdfName = entry.pdf_filename ?? '';
    if (!pdfName) return;

    const docs = this.newDocuments();
    const idx = docs.findIndex((d) => (d.pdf_filename ?? '') === pdfName);
    if (idx >= 0) {
      const updated = [...docs];
      updated[idx] = { ...updated[idx], ...entry };
      this.newDocuments.set(updated);
    } else {
      const insert = (entry.status ?? '').toLowerCase() === 'new' ? [entry, ...docs] : [...docs, entry];
      this.newDocuments.set(insert);
    }
  }

  // Helper: compute base name for processing
  public baseFromFilename(pdfFilename?: string): string {
    if (!pdfFilename) return '';
    return pdfFilename.replace(/\.pdf$/i, '');
  }

  // Check whether a document is processing
  public isProcessing(pdfFilename?: string): boolean {
    const base = this.baseFromFilename(pdfFilename);
    return !!this.processingMap[base];
  }

  // Call backend process endpoint to start processing a document
  processDocument(entry: DhrpEntry): void {
    const base = this.baseFromFilename(entry.pdf_filename);
    if (!base) {
      this.processMessage.set('Invalid filename for processing');
      return;
    }
    if (this.processingMap[base]) return;
    this.processingMap[base] = true;
    this.saveProcessingState();
    this.processMessage.set('');
    // Set status to Processing locally and persist
    const docs = this.newDocuments();
    const idx = docs.findIndex((d) => this.baseFromFilename(d.pdf_filename) === base);
    if (idx >= 0) {
      const updated = [...docs];
      updated[idx] = { ...updated[idx], status: 'Processing' };
      this.newDocuments.set(updated);
    }
    this.saveProcessingState();
    // Start processing in backend
    this.http
      .post<{ success: boolean; message?: string }>(`${this.PROCESS_ENDPOINT_BASE}/${encodeURIComponent(base)}`, {})
      .pipe(
        catchError((err) => {
          console.error('Process start error', err);
          this.processMessage.set(err?.error?.message || 'Failed to start processing');
          this.processingMap[base] = false;
          this.saveProcessingState();
          return of(null);
        })
      )
      .subscribe((res) => {
        if (res && res.success) {
          this.processMessage.set(res.message || 'Processing started');
          this.pollProcessingStatus(base, entry.pdf_filename);
        } else {
          this.processMessage.set(res?.message || 'Failed to start processing');
          this.processingMap[base] = false;
          this.saveProcessingState();
        }
      });
  }

  // Navigate to processing-status for a specific document (for Action column)
  viewProcessingStatus(entry: DhrpEntry): void {
    const base = this.baseFromFilename(entry.pdf_filename);
    if (base) {
      this.router.navigate(['/processing-status', base]);
    }
  }

  // Navigate to mapper for a specific document (for Preview column)
  viewDocumentMapper(entry: DhrpEntry): void {
    const base = this.baseFromFilename(entry.pdf_filename);
    if (base) {
      // Try to get from entry first, then fallback to localStorage
      let typeName = entry.document_type_name;
      if (!typeName) {
        typeName = localStorage.getItem(`doc_type_${base}`) || undefined;
      }
      this.router.navigate(['/mapper', base], { queryParams: typeName ? { type_name: typeName } : {} });
    }
  }

  // Save upload state to localStorage
  private saveUploadState(): void {
    const state = {
      files: this.files().map(f => ({
        name: f.file.name,
        size: f.file.size,
        type: f.file.type,
        id: f.id
      })),
      companyName: this.companyName(),
      uploadDate: this.uploadDate(),
      uploaderName: this.uploaderName(),
      documentTypeId: this.documentTypeId(),
      uploadInProgress: this.uploadInProgress(),
      uploadElapsedSeconds: this.uploadElapsedSeconds(),
      progressMap: this.progressMap,
      uploadMessage: this.uploadMessage(),
      uploadCompleted: this.uploadCompleted(),
    };
    localStorage.setItem(this.UPLOAD_STATE_KEY, JSON.stringify(state));
  }

  // Restore upload state from localStorage
  private restoreUploadState(): void {
    const raw = localStorage.getItem(this.UPLOAD_STATE_KEY);
    if (!raw) return;
    try {
      const state = JSON.parse(raw);
      if (state.files && Array.isArray(state.files)) {
        // We cannot restore File objects, so just show file names as placeholders
        this.files.set(state.files.map((f: any) => ({
          file: { name: f.name, size: f.size, type: f.type } as File,
          id: f.id
        })));
      }
      if (state.companyName) this.companyName.set(state.companyName);
      if (state.uploadDate) this.uploadDate.set(state.uploadDate);
      if (state.uploaderName) this.uploaderName.set(state.uploaderName);
      if (state.documentTypeId !== undefined) this.documentTypeId.set(state.documentTypeId);
      if (state.uploadInProgress) this.uploadInProgress.set(state.uploadInProgress);
      if (state.uploadElapsedSeconds) this.uploadElapsedSeconds.set(state.uploadElapsedSeconds);
      if (state.progressMap) this.progressMap = state.progressMap;
      if (state.uploadMessage) this.uploadMessage.set(state.uploadMessage);
      if (state.uploadCompleted) this.uploadCompleted.set(state.uploadCompleted);
    } catch {}
  }

  // Clear upload state from localStorage
  private clearUploadState(): void {
    localStorage.removeItem(this.UPLOAD_STATE_KEY);
  }

  // --- Persistent Processing State ---
  private saveProcessingState(): void {
    localStorage.setItem('processingMap', JSON.stringify(this.processingMap));
    localStorage.setItem('newDocuments', JSON.stringify(this.newDocuments()));
  }

  private restoreProcessingState(): void {
    const map = localStorage.getItem('processingMap');
    if (map) this.processingMap = JSON.parse(map);
    const docs = localStorage.getItem('newDocuments');
    if (docs) this.newDocuments.set(JSON.parse(docs));
  }

  // --- Polling for Processing Status ---
  private pollProcessingStatus(base: string, pdf_filename?: string): void {
    const poll = () => {
      this.http.get<{ status: string }>(`${this.PROCESS_ENDPOINT_BASE}/status/${encodeURIComponent(base)}`)
        .pipe(catchError(() => of({ status: 'Processing' } as any)))
        .subscribe((res) => {
          const status = (res.status || '').toLowerCase();
          if (status === 'completed') {
            this.processingMap[base] = false;
            // Update UI
            const docs = this.newDocuments();
            const idx = docs.findIndex((d) => this.baseFromFilename(d.pdf_filename) === base);
            if (idx >= 0) {
              const updated = [...docs];
              updated[idx] = { ...updated[idx], status: 'Completed' };
              this.newDocuments.set(updated);
            }
            this.saveProcessingState();
          } else {
            // Still processing, keep polling
            setTimeout(poll, 3000);
          }
        });
    };
    poll();
  }

}