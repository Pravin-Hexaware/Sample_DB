import{ Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { API_BASE_URL } from '../../api-base';
interface Answer {
  id: string;
  question: string;
  answer: string;
  confidence: number;
  pages: number[];
  status: 'answered' | 'low-confidence' | 'not-found';
  AnswerHtml?: string;
  parsedAnswer?: any;
}
@Component({
  selector: 'app-results',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, HttpClientModule],
  templateUrl: './results.html',
  styleUrl: './results.css',
})
export class Results implements OnInit {
  docId: string | null = null;
  typeId: string | null = null;
  selectedQuestionId: string | null = null;
  searchTerm = '';
  confidenceFilter: 'all' | 'high' | 'low' | 'missing' = 'all';
  answers: Answer[] = [];
  columns: string[] = [];
  rows: any[] = [];
  filename = '';
  baseName = '';
  pdfBase = '';
  loading = true;
  private readonly VIEW_CSV_ENDPOINT = `${API_BASE_URL}/view_csv`;
  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private cdr: ChangeDetectorRef
  ) {}
  ngOnInit(): void {
    this.typeId = this.route.snapshot.paramMap.get('typeId');
    this.docId = this.route.snapshot.paramMap.get('id');
    if (this.docId) {
      if (this.docId.endsWith('.pdf')) this.filename = this.docId.replace(/\.pdf$/i, '_analysis.csv');
      else if (!this.docId.endsWith('.csv') && !this.docId.includes('_analysis')) this.filename = `${this.docId}_analysis.csv`;
      else this.filename = this.docId;
    } else {
      this.loading = false;
      return;
    }
    this.loadCsvAndBuildAnswers();
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
    } else if (typeof src === 'object' && src !== null) {
      if (Array.isArray((src as any).page_numbers)) return this.normalizePageNumbers((src as any).page_numbers);
      if ((src as any).page_number != null) return this.normalizePageNumbers((src as any).page_number);
    }
    result.sort((a,b) => a-b);
    return result;
  }
  private async loadCsvAndBuildAnswers(): Promise<void> {
    const url = `${this.VIEW_CSV_ENDPOINT}/${encodeURIComponent(this.filename)}`;
    this.loading = true;
    try {
      const data: any = await fetch(url).then(res => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        return res.json();
      });
      const rows = Array.isArray(data.rows) ? data.rows : Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
      this.columns = Array.isArray(data.columns) ? data.columns : [];
      this.baseName = data.base_name || this.filename.replace(/_analysis\.csv$/i, '');
      this.pdfBase = data.pdf_base || data.base_name || this.baseName || '';
      if (this.pdfBase && !this.pdfBase.toLowerCase().endsWith('.pdf')) this.pdfBase = `${this.pdfBase}.pdf`;
      this.rows = rows;
      this.answers = rows.map((row: Record<string, any>, index: number) => {
        const question = (row['DataField'] ?? row['datafield'] ?? row['Question'] ?? row['question'] ?? '').toString();
        const answerText = (row['Answer'] ?? row['answer'] ?? '').toString();
        const scoreRaw = row['Score'] ?? row['score'] ?? 0;
        const scoreNum = Number(scoreRaw);
        const confidence = isNaN(scoreNum) ? 0 : Math.max(0, Math.min(100, scoreNum)) / 100;
        // Only use page columns from CSV
        const pagesRaw = row['Page'] ?? row['Pages'] ?? row['page'] ?? row['pages'] ?? row['PageNumber'] ?? row['Page Number'] ?? null;
        const pages = this.normalizePageNumbers(pagesRaw);
        const answerHtml = answerText;
        let status: Answer['status'];
if (!answerText || answerText.trim() === '' || confidence === 0) {
  status = 'not-found';
} else if (confidence >= 0.1 && confidence < 0.7) {
  status = 'low-confidence';
} else if (confidence >= 0.7) {
  status = 'answered';
} else {
  status = 'not-found'; // fallback for any other case
}
        return {
          id: String(index + 1),
          question,
          answer: answerText,
          confidence,
          pages,
          status,
          AnswerHtml: answerHtml,
          parsedAnswer: { type: 'text', data: answerText, metadata: {} }
        };
      });
      console.debug('Built answers sample:', this.answers.slice(0, 6).map(a => ({ id: a.id, pages: a.pages })));
      this.selectedQuestionId = this.answers.length ? this.answers[0].id : null;
      this.loading = false;
      this.cdr.markForCheck();
    } catch (err) {
      console.error('Fetch error:', err);
      alert('Failed to load Q/A data.');
      this.loading = false;
      this.cdr.markForCheck();
    }
  }
  get filteredAnswers(): Answer[] {
  const term = this.searchTerm.trim().toLowerCase();
  return this.answers.filter((answer) => {
    const matchesSearch = answer.question.toLowerCase().includes(term);
    const matchesConfidence =
      this.confidenceFilter === 'all' ||
      (this.confidenceFilter === 'high' && answer.confidence >= 0.7) ||
      (this.confidenceFilter === 'low' && answer.confidence >= 0.1 && answer.confidence < 0.7) ||
      (this.confidenceFilter === 'missing' && answer.confidence === 0);
    return matchesSearch && matchesConfidence;
  });
}
  get selectedAnswer(): Answer | undefined {
    if (this.selectedQuestionId) {
      return this.answers.find((a) => a.id === this.selectedQuestionId);
    }
    return this.filteredAnswers[0];
  }
  selectQuestion(id: string): void {
    this.selectedQuestionId = id;
  }
  getConfidenceColor(confidence: number): string {
    if (confidence >= 0.7) return 'green';
    if (confidence >= 0.5) return 'yellow';
    return 'red';
  }
  get failedCount(): number {
    return this.answers.filter((a) => a.status === 'low-confidence' || a.status === 'not-found').length;
  }
  viewSource(page: number): void {
    console.log('[Results] viewSource called with page:', page, 'questionId:', this.selectedAnswer?.id);
    if (this.docId && this.selectedAnswer) {
      this.router.navigate(['compare-view', this.docId], {
        queryParams: { question: this.selectedAnswer.id, page }
      });
    }
  }
  reviewFailed(): void {
    if (this.docId && this.typeId) {
      this.router.navigate(['/failed-answer-review', this.typeId, this.docId]);
    } else {
      alert('Document ID or Type is missing!');
    }
  }
  getConfidenceClass(confidence: number): string {
    if (confidence >= 0.7) return 'text-green-600';
    if (confidence >= 0.5) return 'text-yellow-600';
    return 'text-red-600';
  }
  readonly BACKEND = API_BASE_URL;
  exportExcel(): void {
    // Assuming your CSV filename is the analysis CSV you loaded
    const csvName = this.filename; // e.g., "pro_bridgewaterallweatheretf_second_analysis.csv"
    const url = `${this.BACKEND}/download/${encodeURIComponent(csvName)}`;
    window.open(url, '_blank');
  }
  exportPDF(): void {
  let pdfName = this.docId || '';
  if (pdfName.endsWith('_analysis.csv')) {
    pdfName = pdfName.replace('_analysis.csv', '.pdf');
  } else if (pdfName.endsWith('.csv')) {
    pdfName = pdfName.replace('.csv', '.pdf');
  } else if (!pdfName.endsWith('.pdf')) {
    pdfName += '.pdf';
  }
  const url = `${this.BACKEND}/download/${encodeURIComponent(pdfName)}`;
  window.open(url, '_blank');
}
// ...existing code...
  goBack(): void {
    this.router.navigate(['/document-library']);
  }
}
 