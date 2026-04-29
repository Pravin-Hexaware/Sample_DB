import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { API_BASE_URL } from '../../api-base';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';

interface DhrpEntry {
  id?: number;
  company: string;
  bse_code?: string;
  upload_date?: string;
  uploader_name?: string;
  promoter?: string;
  pdf_filename?: string;
  status?: string;
  toc_verified?: boolean;
  document_type?: string;
  doc_type?: number;
}

interface DocumentType {
  id: number;
  name: string;
}

@Component({
  selector: 'app-document-library',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule],
  templateUrl: './document-library.html',
  styleUrl: './document-library.css',
})
export class DocumentLibrary implements OnInit {
  searchTerm = '';
  statusFilter: 'all' | 'completed' | 'processing' | 'new' = 'all';
  documents = signal<DhrpEntry[]>([]);
  isLoading = signal(false);
  loadError = signal('');
  documentTypes: Map<number, string> = new Map();

  private readonly GET_DHRPS_ENDPOINT = `${API_BASE_URL}/get_all_dhrps`;
  private readonly GET_TYPES_ENDPOINT = `${API_BASE_URL}/document-types`;
  private readonly DELETE_ENDPOINT_BASE = `${API_BASE_URL}/delete`;

  constructor(private router: Router, private http: HttpClient) {}

  ngOnInit(): void {
    // Initialize helper after router and http are set up
    this.loadDocumentTypes();
    // Load documents after a small delay to ensure types are loaded
    setTimeout(() => this.loadDocuments(), 500);
  }

  // Load document types from backend
  private loadDocumentTypes(): void {
    this.http
      .get<{ success?: boolean; document_types?: DocumentType[] }>(this.GET_TYPES_ENDPOINT)
      .pipe(
        catchError((err) => {
          console.error('Failed to load document types', err);
          return of(null);
        })
      )
      .subscribe((res) => {
        if (res && Array.isArray(res.document_types)) {
          res.document_types.forEach(dt => {
            this.documentTypes.set(dt.id, dt.name);
          });
          // Load documents after types are ready
          this.loadDocuments();
        }
      });
  }

  // Load documents from backend
  loadDocuments(): void {
    this.isLoading.set(true);
    this.loadError.set('');
    this.http
      .get<DhrpEntry[]>(this.GET_DHRPS_ENDPOINT)
      .pipe(
        catchError((err) => {
          console.error('Failed to load documents', err);
          this.loadError.set('Failed to load documents');
          this.isLoading.set(false);
          return of(null);
        })
      )
      .subscribe((res: any) => {
        // Merge with local processingMap
        let processingMap: Record<string, boolean> = {};
        try {
          const raw = localStorage.getItem('processingMap');
          if (raw) processingMap = JSON.parse(raw);
        } catch {}
        if (Array.isArray(res)) {
          // Add document type name from the map
          const enriched = res.map(doc => {
            let typeName = '';
            // First try from doc_type ID mapping
            if (doc.doc_type) {
              typeName = this.documentTypes.get(doc.doc_type) || '';
            }
            // Fallback to localStorage if not in map
            let base = '';
            if (!typeName) {
              base = doc.pdf_filename?.replace(/\.pdf$/i, '') || '';
              typeName = localStorage.getItem(`doc_type_${base}`) || '';
            } else if (doc.pdf_filename) {
              base = doc.pdf_filename.replace(/\.pdf$/i, '');
            }
            // Only override to 'Processing' if not completed
            let status = doc.status;
            if (base && processingMap[base] && (!status || status.toLowerCase() !== 'completed')) {
              status = 'Processing';
            }
            // If status is completed, remove from processing state/localStorage
            if (status && status.toLowerCase() === 'completed' && doc.pdf_filename) {
              this.removeFromProcessingState(doc.pdf_filename);
            }
            return {
              ...doc,
              document_type: typeName || doc.document_type || '',
              status
            };
          });
          this.documents.set(enriched);
        } else {
          this.documents.set([]);
        }
        this.isLoading.set(false);
      });
  }

  get filteredDocuments(): DhrpEntry[] {
    const term = this.searchTerm.trim().toLowerCase();
    return this.documents().filter((doc) => {
      const matchesSearch =
        doc.company?.toLowerCase().includes(term) ||
        doc.pdf_filename?.toLowerCase().includes(term) ||
        doc.uploader_name?.toLowerCase().includes(term);
      const docStatus = (doc.status ?? '').toLowerCase();
      const matchesStatus =
        this.statusFilter === 'all' ||
        docStatus === this.statusFilter;
      return matchesSearch && matchesStatus;
    });
  }

  // Helper: compute base name for processing
  public baseFromFilename(pdfFilename?: string): string {
    if (!pdfFilename) return '';
    return pdfFilename.replace(/\.pdf$/i, '');
  }

  // Navigate to results for a specific document
  viewDocument(doc: DhrpEntry): void {
    const status = (doc.status ?? '').toLowerCase();

    // Check if status is completed before showing results
    if (status !== 'completed') {
      alert('Process the document to view results');
      return;
    }

    // Navigate to results with document ID
    if (doc.id) {
      this.router.navigate(['/results', doc.id]);
    } else {
      // Fallback: use pdf_filename if id is not available
      const base = this.baseFromFilename(doc.pdf_filename);
      if (base) {
        this.router.navigate(['/results', base]);
      }
    }
  }

  // Get status label
  getStatusLabel(status?: string): string {
    if (!status) return 'Unknown';
    return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  }

  // Delete a document
  deleteDocument(doc: DhrpEntry): void {
    // Quick confirmation
    if (!confirm(`Delete ${doc.pdf_filename}?`)) {
      return;
    }

    const base = this.baseFromFilename(doc.pdf_filename);
    if (!base) {
      alert('Cannot delete: invalid document');
      return;
    }

    this.http
      .delete<{ success: boolean; message?: string }>(
        `${this.DELETE_ENDPOINT_BASE}/${encodeURIComponent(base)}`
      )
      .subscribe({
        next: (res) => {
          // Remove from persistent processing state to stop polling and 404s
          this.removeFromProcessingState(doc.pdf_filename ?? '');
          console.log('Delete successful, reloading immediately...');
          window.location.reload();
        },
        error: (err) => {
          console.error('Delete failed:', err);
          const errorMsg = err?.error?.message || err?.message || 'Unknown error';
          alert(`Failed to delete: ${errorMsg}`);
        }
      });

  }

  // Remove a document from processing state and localStorage (moved from DocumentUpload)
  private removeFromProcessingState(pdfFilename: string): void {
    const base = this.baseFromFilename(pdfFilename);
    // Remove from processingMap
    let processingMap: Record<string, boolean> = {};
    try {
      const raw = localStorage.getItem('processingMap');
      if (raw) processingMap = JSON.parse(raw);
    } catch {}
    if (base in processingMap) {
      delete processingMap[base];
      localStorage.setItem('processingMap', JSON.stringify(processingMap));
    }
    // Remove from newDocuments
    let docs: any[] = [];
    try {
      const rawDocs = localStorage.getItem('newDocuments');
      if (rawDocs) docs = JSON.parse(rawDocs);
    } catch {}
    const filtered = docs.filter((d) => (d.pdf_filename ? this.baseFromFilename(d.pdf_filename) !== base : true));
    localStorage.setItem('newDocuments', JSON.stringify(filtered));
  }

  goToResults(entry: DhrpEntry) {
    const status = (entry.status ?? '').toLowerCase();

    // Check if status is completed before showing results
    if (status !== 'completed') {
      alert('Process the document to view results');
      return;
    }
    if (!entry.document_type || !entry.pdf_filename) {
      alert('Missing document type or file name!');
      return;
    }
    const base = entry.pdf_filename.replace(/\.pdf$/i, '');
    this.router.navigate(['/results', entry.document_type, base]);
  }
}