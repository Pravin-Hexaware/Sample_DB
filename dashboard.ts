import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatPaginatorModule } from '@angular/material/paginator';
import { RouterModule, Router } from '@angular/router';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { API_BASE_URL } from '../../api-base';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';

interface StatsItem {
  label: string;
  value: string;
  change: string;
  icon: string;
  color: string;
}

/** Interface matching the /get_all_dhrps JSON structure */
interface DhrpEntry {
  id?: number;
  company: string;
  bse_code: string;
  upload_date: string;
  uploader_name: string;
  promoter: string | null;
  pdf_filename: string | null;
  status: string;
  toc_verified: boolean;
  document_type: string;
  doc_type?: number;
}

interface DocumentType {
  id: number;
  name: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, HttpClientModule, MatPaginatorModule],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.css'],
})
export class Dashboard implements OnInit {
  stats: StatsItem[] = [
    { label: 'Total Documents', value: '-', change: '', icon: 'description', color: 'blue' },
    { label: 'Processed Documents', value: '-', change: '', icon: 'check_circle', color: 'green' },
    { label: 'Pending Documents', value: '-', change: '', icon: 'schedule', color: 'yellow' },
    //{ label: 'Failed Questions', value: '23', change: 'Needs review', icon: 'error', color: 'red' },
  ];

  // Now using DHRP entries as the source for recent uploads / list
  dhrpEntries: DhrpEntry[] = [];
  documentTypes: Map<number, string> = new Map();

  isLoading = false;
  errorMessage = '';

  // Direct endpoints (as requested)
  private readonly STATUS_SUMMARY_ENDPOINT = `${API_BASE_URL}/documents/status-summary`;
  private readonly GET_ALL_DHRPS_ENDPOINT = `${API_BASE_URL}/get_all_dhrps`;
  private readonly GET_TYPES_ENDPOINT = `${API_BASE_URL}/document-types`;

  constructor(private http: HttpClient, private router: Router) {}

  ngOnInit(): void {
    this.loadDocumentStats();
    this.loadDocumentTypes();
    setTimeout(() => this.loadDhrpEntries(), 500);
    this.loadTotalFailedAnswers();
  }

  loadDocumentStats(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.http
      .get<{ total_documents: number; completed_documents: number; pending_documents: number }>(
        this.STATUS_SUMMARY_ENDPOINT
      )
      .pipe(
        catchError((err) => {
          this.errorMessage = 'Failed to load document stats';
          this.isLoading = false;
          return of(null);
        })
      )
      .subscribe((data) => {
        if (data) {
          this.stats = [
            { label: 'Total Documents', value: data.total_documents.toString(), change: '', icon: 'description', color: 'blue' },
            { label: 'Processed Documents', value: data.completed_documents.toString(), change: '', icon: 'check_circle', color: 'green' },
            { label: 'Pending Documents', value: data.pending_documents.toString(), change: '', icon: 'schedule', color: 'yellow' },
            { label: 'Failed Questions', value: '23', change: 'Needs review', icon: 'error', color: 'red' },
          ];
        }
        this.isLoading = false;
      });
  }

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
          this.loadDhrpEntries();
        }
      });
  }

  loadDhrpEntries(): void {
    this.http
      .get<DhrpEntry[]>(this.GET_ALL_DHRPS_ENDPOINT)
      .pipe(
        catchError((err) => {
          this.errorMessage = 'Failed to load DHRP entries';
          return of([] as DhrpEntry[]);
        })
      )
      .subscribe((entries) => {
        // Merge with local processingMap
        let processingMap: Record<string, boolean> = {};
        try {
          const raw = localStorage.getItem('processingMap');
          if (raw) processingMap = JSON.parse(raw);
        } catch {}
        if (Array.isArray(entries)) {
          const enriched = entries.map(entry => {
            let typeName = '';
            if (entry.doc_type) {
              typeName = this.documentTypes.get(entry.doc_type) || '';
            }
            let base = '';
            if (entry.pdf_filename) {
              base = entry.pdf_filename.replace(/\.pdf$/i, '');
              if (!typeName) {
                typeName = localStorage.getItem(`doc_type_${base}`) || '';
              }
            }
            // Only override to 'Processing' if not completed
            let status = entry.status;
            if (base && processingMap[base] && (!status || status.toLowerCase() !== 'completed')) {
              status = 'Processing';
            }
            return {
              ...entry,
              document_type: typeName || entry.document_type || '',
              status
            };
          });
          this.dhrpEntries = enriched;
        } else {
          this.dhrpEntries = [];
        }
      });
  }

  // Pagination state
  pageSize = 5;
  currentPage = 1;

  get totalPages(): number {
    return Math.ceil(this.dhrpEntries.length / this.pageSize) || 1;
  }

  get paginatedDocuments(): DhrpEntry[] {
    const sorted = [...this.dhrpEntries].sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
    const start = (this.currentPage - 1) * this.pageSize;
    return sorted.slice(start, start + this.pageSize);
  }

  goToPage(page: number) {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
  }

  nextPage() {
    if (this.currentPage < this.totalPages) this.currentPage++;
  }

  prevPage() {
    if (this.currentPage > 1) this.currentPage--;
  }

  public baseFromFilename(pdfFilename?: string): string {
    if (!pdfFilename) return '';
    return pdfFilename.replace(/\.pdf$/i, '');
  }

  viewDocument(doc: DhrpEntry): void {
    const status = (doc.status ?? '').toLowerCase();
    if (status !== 'completed') {
      alert('Process the document to view results');
      return;
    }
    if (doc.id) {
      this.router.navigate(['/results', doc.id]);
    }
  }

  goToDocumentLibrary(): void {
    this.router.navigate(['/document-library']);
  }

  getStatusLabel(status?: string): string {
    if (!status) return 'Unknown';
    return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  }

  // Refresh both stats and entries from UI (callable from template)
  refreshAll(): void {
    this.loadDocumentStats();
    this.loadDhrpEntries();
  }

  // Status CSS helper (keeps previous behaviour)
  statusClass(status: string): string {
    if (status === 'Completed') return 'status-completed';
    if (status === 'Processing') return 'status-processing';
    return 'status-failed';
  }

  goToResults(entry: DhrpEntry) {
    const status = (entry.status ?? '').toLowerCase();
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
  totalFailedAnswers: number | null = null;

loadTotalFailedAnswers(): void {
  this.http
    .get<{ success: boolean; total_failed: number }>(`${API_BASE_URL}/failed_answers/total`)
    .pipe(
      catchError((err) => {
        console.error('Failed to load total failed answers', err);
        this.totalFailedAnswers = null;
        return of({ success: false, total_failed: 0 });
      })
    )
    .subscribe((resp) => {
      if (resp && resp.success) {
        this.totalFailedAnswers = resp.total_failed;
      } else {
        this.totalFailedAnswers = null;
      }
    });
  }
    // Material paginator event handler
  onMatPageChange(event: any): void {
    this.pageSize = event.pageSize;
    this.currentPage = event.pageIndex + 1;
  }

}