import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { API_BASE_URL } from '../../api-base';

interface FailedAnswer {
  id: string;
  dataField?: string;      // <-- add
  particulars?: string;
  question: string;
  aiAnswer: string;
  confidence: number;
  pages: number[];
  status: 'low-confidence' | 'not-found';
  manualAnswer?: string;
  manualPage?: number;
  resolved: boolean;
}

@Component({
  selector: 'app-failed-answer-review',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule],
  templateUrl: './failed-answer-review.html',
  styleUrl: './failed-answer-review.css',
})
export class FailedAnswerReview implements OnInit {
  answers = signal<FailedAnswer[]>([]);
  documentId: string = '';
  documentType: string = '';
  pageNumbers: number[] = [];
  loading: boolean = false;
  errorMessage: string = '';

  private http = inject(HttpClient);

  constructor(
    private activatedRoute: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit() {
    this.documentType = this.activatedRoute.snapshot.paramMap.get('typeId') || '';
    this.documentId = this.activatedRoute.snapshot.paramMap.get('id') || '';
    console.log('[ngOnInit] Loaded FailedAnswerReview with documentType:', this.documentType, 'documentId:', this.documentId);
    this.fetchFailedAnswers();
  }

  fetchFailedAnswers() {
    if (!this.documentType || !this.documentId) {
      console.log('[fetchFailedAnswers] Missing documentType or documentId. documentType:', this.documentType, 'documentId:', this.documentId);
      return;
    }
    this.loading = true;
    this.errorMessage = '';
    const url = `${API_BASE_URL}/failed_answers/${encodeURIComponent(this.documentType)}/${encodeURIComponent(this.documentId)}`;
    console.log('[fetchFailedAnswers] GET', url);
    this.http.get<{ success: boolean, answers: FailedAnswer[] }>(url)
      .subscribe({
        next: (resp) => {
          console.log('[fetchFailedAnswers] API response:', resp);
          if (resp && resp.success) {
            this.answers.set(resp.answers);
            console.log('[fetchFailedAnswers] Set answers, count:', resp.answers.length);
            if (resp.answers.length > 0) {
              console.log('[fetchFailedAnswers] Sample answer:', resp.answers[0]);
            }
            const maxPage = Math.max(1, ...resp.answers.flatMap(a => a.pages ?? []));
            this.pageNumbers = Array.from({ length: maxPage || 1 }, (_, i) => i + 1);
            console.log('[fetchFailedAnswers] pageNumbers:', this.pageNumbers);
          } else {
            this.errorMessage = 'Failed to load failed answers.';
            console.log('[fetchFailedAnswers] Error:', this.errorMessage);
          }
          this.loading = false;
        },
        error: (err) => {
          this.loading = false;
          this.errorMessage = err?.message || 'Failed to load failed answers.';
          console.log('[fetchFailedAnswers] HTTP error:', this.errorMessage, err);
        }
      });
  }

  get unresolvedCount(): number {
    const count = this.answers().filter(a => !a.resolved).length;
    console.log('[unresolvedCount] Count:', count);
    return count;
  }

  get resolvedCount(): number {
    const count = this.answers().filter(a => a.resolved).length;
    console.log('[resolvedCount] Count:', count);
    return count;
  }

  handleManualAnswerChange(id: string, answer: string) {
    console.log('[handleManualAnswerChange] id:', id, 'answer:', answer);
    const currentAnswers = this.answers();
    const updated = currentAnswers.map(a =>
      a.id === id ? { ...a, manualAnswer: answer } : a
    );
    this.answers.set(updated);
  }

  handleManualPageChange(id: string, page: number) {
    console.log('[handleManualPageChange] id:', id, 'page:', page);
    const currentAnswers = this.answers();
    const updated = currentAnswers.map(a =>
      a.id === id ? { ...a, manualPage: page } : a
    );
    this.answers.set(updated);
  }

  handleResolve(id: string) {
    console.log('[handleResolve] id:', id);
    const currentAnswers = this.answers();
    const updated = currentAnswers.map(a =>
      a.id === id ? { ...a, resolved: true } : a
    );
    this.answers.set(updated);
  }

  handleEditAgain(id: string) {
    console.log('[handleEditAgain] id:', id);
    const currentAnswers = this.answers();
    const updated = currentAnswers.map(a =>
      a.id === id ? { ...a, resolved: false } : a
    );
    this.answers.set(updated);
  }

  canResolve(answer: FailedAnswer): boolean {
    const can = !!answer.manualAnswer && !!answer.manualPage;
    console.log('[canResolve] answer.id:', answer.id, 'canResolve:', can);
    return can;
  }

  handleSaveAll() {
    const toSave = this.answers().filter(a => a.resolved).map(a => ({
      id: a.id,
      manualAnswer: a.manualAnswer,
      manualPage: a.manualPage
    }));
    console.log('[handleSaveAll] Saving answers:', toSave);
    if (toSave.length === 0) {
      alert('No resolved answers to save.');
      return;
    }
    this.loading = true;
    const url = `${API_BASE_URL}/failed_answers/${encodeURIComponent(this.documentType)}/${encodeURIComponent(this.documentId)}`;
    console.log('[handleSaveAll] POST', url, 'payload:', { answers: toSave });
    this.http.post<{ success: boolean }>(url, { answers: toSave })
      .subscribe({
        next: (resp) => {
          this.loading = false;
          console.log('[handleSaveAll] POST response:', resp);
          if (resp && resp.success) {
            alert('Saved successfully!');
            // Navigate back to results with both params
            this.router.navigate(['/results', this.documentType, this.documentId]);
          } else {
            alert('Save failed.');
          }
        },
        error: (err) => {
          this.loading = false;
          console.log('[handleSaveAll] POST error:', err);
          alert('Save failed: ' + (err?.message || 'Unknown error'));
        }
      });
  }

  backToResults() {
  this.router.navigate(['/results', this.documentType, this.documentId]);
}
}