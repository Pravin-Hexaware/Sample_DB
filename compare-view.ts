import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { API_BASE_URL } from '../../api-base';

interface Answer {
  id: string;
  question: string;
  answer: string;
  confidence: number;
  pages: number[];
  status: 'answered' | 'low-confidence' | 'not-found';
}

@Component({
  selector: 'app-compare-view',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule],
  templateUrl: './compare-view.html',
  styleUrl: './compare-view.css',
})
export class CompareView implements OnInit {
  currentPage = signal(1);
  zoom = signal(100);
  searchTerm = signal('');
  documentId: string = '';
  questionId: string = '';
  totalPages = 1;
  answers: Answer[] = [];
  columns: string[] = [];
  rows: any[] = [];
  loading = true;
  pdfUrl: SafeResourceUrl | null = null;

  thumbnails: number[] = [];

  private readonly VIEW_CSV_ENDPOINT = `${API_BASE_URL}/view_csv`;

  constructor(
    private activatedRoute: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit() {
    this.activatedRoute.paramMap.subscribe(params => {
      this.documentId = params.get('id') || '';
      if (this.documentId) {
        this.loadAnswers();
        this.setPdfUrl();
      }
    });

    this.activatedRoute.queryParamMap.subscribe(queryParams => {
      this.questionId = queryParams.get('question') || '';
      const initialPage = parseInt(queryParams.get('page') || '1');
      this.currentPage.set(initialPage);
      this.setPdfUrl();
    });
  }

  loadAnswers(): void {
    let filename = '';
    if (this.documentId.endsWith('.pdf')) filename = this.documentId.replace(/\.pdf$/i, '_analysis.csv');
    else if (!this.documentId.endsWith('.csv') && !this.documentId.includes('_analysis')) filename = `${this.documentId}_analysis.csv`;
    else filename = this.documentId;

    const url = `${this.VIEW_CSV_ENDPOINT}/${encodeURIComponent(filename)}`;
    this.loading = true;

    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        return res.json();
      })
      .then(data => {
        const rows = Array.isArray(data.rows) ? data.rows : Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
        this.answers = rows.map((row: Record<string, any>, index: number) => {
          const question = (row['DataField'] ?? row['datafield'] ?? row['Question'] ?? row['question'] ?? '').toString();
          const answerText = (row['Answer'] ?? row['answer'] ?? '').toString();
          const scoreRaw = row['Score'] ?? row['score'] ?? 0;
          const scoreNum = Number(scoreRaw);
          const confidence = isNaN(scoreNum) ? 0 : Math.max(0, Math.min(100, scoreNum)) / 100;

          const pagesRaw = row['Page'] ?? row['Pages'] ?? row['page'] ?? row['pages'] ?? row['PageNumber'] ?? row['Page Number'] ?? null;
          const pages = this.normalizePageNumbers(pagesRaw);

          let status: Answer['status'];
          if (!answerText || answerText.trim() === '' || confidence === 0) {
            status = 'not-found';
          } else if (confidence > 0.4 && confidence < 0.7) {
            status = 'low-confidence';
          } else if (confidence >= 0.7) {
            status = 'answered';
          } else {
            status = 'not-found';
          }

          return {
            id: String(index + 1),
            question,
            answer: answerText,
            confidence,
            pages,
            status
          };
        });

        // Dynamically determine totalPages from answers' pages
        let maxPage = 1;
        for (const ans of this.answers) {
          if (ans.pages && ans.pages.length > 0) {
            const localMax = Math.max(...ans.pages);
            if (localMax > maxPage) maxPage = localMax;
          }
        }
        this.totalPages = maxPage;
        this.thumbnails = Array.from({ length: this.totalPages }, (_, i) => i + 1);

        this.loading = false;
      })
      .catch(err => {
        console.error('Fetch error:', err);
        this.loading = false;
      });
  }

  private normalizePageNumbers(src: any): number[] {
    if (!src && src !== 0) return [];
    const result: number[] = [];
    const pushNum = (n: number) => {
      if (!Number.isFinite(n)) return;
      const nn = Math.floor(n);
      if (!result.includes(nn)) result.push(nn);
    };

    if (Array.isArray(src)) {
      for (const item of src) {
        if (item == null) continue;
        if (typeof item === 'number') pushNum(item);
        else if (typeof item === 'string') {
          const parts = item.split(/[,;]+/);
          for (const p of parts) {
            const s = p.trim();
            if (!s) continue;
            const rangeMatch = s.match(/^(\d+)\s*-\s*(\d+)$/);
            if (rangeMatch) {
              const a = Number(rangeMatch[1]), b = Number(rangeMatch[2]);
              if (!isNaN(a) && !isNaN(b)) {
                for (let i = Math.min(a,b); i <= Math.max(a,b); i++) pushNum(i);
              }
            } else {
              const n = Number(s);
              if (!isNaN(n)) pushNum(n);
            }
          }
        }
      }
    } else if (typeof src === 'string') {
      const parts = src.split(/[,;]+/);
      for (const p of parts) {
        const s = p.trim();
        if (!s) continue;
        const rangeMatch = s.match(/^(\d+)\s*-\s*(\d+)$/);
        if (rangeMatch) {
          const a = Number(rangeMatch[1]), b = Number(rangeMatch[2]);
          if (!isNaN(a) && !isNaN(b)) {
            for (let i = Math.min(a,b); i <= Math.max(a,b); i++) pushNum(i);
          }
        } else {
          const n = Number(s);
          if (!isNaN(n)) pushNum(n);
        }
      }
    } else if (typeof src === 'number') {
      pushNum(src);
    }
    result.sort((a,b) => a-b);
    return result;
  }

  get selectedAnswer(): Answer | undefined {
    return this.answers.find(a => a.id === this.questionId);
  }

  // PDF.js or browser viewer support #page=N
  setPdfUrl() {
    if (this.documentId) {
      const backend = API_BASE_URL;
      // Add a random query param to force iframe reload on every jump
      const cacheBuster = Math.random().toString(36).substring(2, 10);
      let url = `${backend}/uploads/${this.documentId}.pdf?cb=${cacheBuster}`;
      if (this.currentPage() > 1) {
        url = `${url}#page=${this.currentPage()}`;
      }
      this.pdfUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
    }
  }

  handleZoomIn() {
    this.zoom.set(Math.min(this.zoom() + 10, 200));
  }

  handleZoomOut() {
    this.zoom.set(Math.max(this.zoom() - 10, 50));
  }

  jumpToPage(page: number) {
    console.log('[CompareView] jumpToPage called with page:', page);
    this.currentPage.set(page);
    this.setPdfUrl();
  }

  previousPage() {
    this.currentPage.set(Math.max(1, this.currentPage() - 1));
    this.setPdfUrl();
  }

  nextPage() {
    this.currentPage.set(Math.min(this.totalPages, this.currentPage() + 1));
    this.setPdfUrl();
  }

  goToPage(event: any) {
    const page = parseInt(event.target.value);
    if (!isNaN(page)) {
      this.currentPage.set(Math.max(1, Math.min(this.totalPages, page)));
      this.setPdfUrl();
    }
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'answered': return '✓';
      case 'low-confidence': return '⚠';
      case 'not-found': return '✗';
      default: return '';
    }
  }

  getConfidenceColor(confidence: number): string {
    if (confidence >= 0.8) return 'green';
    if (confidence >= 0.5) return 'yellow';
    return 'red';
  }

  getPageContent(): string {
    // Placeholder: this would show the actual PDF page or highlight in a real viewer
    const page = this.currentPage();
    return `PDF page content for page ${page}`;
  }

  isSourcePage(page: number): boolean {
    return this.selectedAnswer?.pages.includes(page) || false;
  }

  goBack() {
    this.router.navigate([`/results`, this.documentId]);
  }
}