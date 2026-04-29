import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { API_BASE_URL } from '../../api-base';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';

interface DocumentType { id: number; name: string; }

@Component({
  selector: 'app-questions-upload',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule],
  templateUrl: './questions-upload.html',
  styleUrls: ['./questions-upload.css'],
})
export class QuestionsUpload implements OnInit {
  file = signal<File | null>(null);
  uploaded = signal(false);

  documentTypes: DocumentType[] = [];
  isLoadingTypes = false;
  typesError = '';

  selectedTypeId = signal<number | 'new' | null>(null);
  newTypeName = '';

  manualSelectedTypeId: number | null = null;

  isUploading = false;
  isUploaded: boolean = false; // success card flag
  uploadMessage = '';

  csvRows: string[][] = [];
  visibleColumns: boolean[] = [];
  showAllRows = false;

  private readonly GET_TYPES_ENDPOINT = `${API_BASE_URL}/document-types`;
  private readonly POST_TYPE_ENDPOINT = `${API_BASE_URL}/document-types`;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.loadDocumentTypes();
  }

  loadDocumentTypes(): void {
    this.isLoadingTypes = true;
    this.typesError = '';
    this.http.get<{ success?: boolean; document_types?: DocumentType[] }>(this.GET_TYPES_ENDPOINT)
      .pipe(catchError(err => {
        this.typesError = 'Failed to load document types';
        this.isLoadingTypes = false;
        return of(null);
      }))
      .subscribe(res => {
        if (res && Array.isArray(res.document_types)) {
          this.documentTypes = res.document_types;
        }
        if (this.documentTypes.length > 0 && this.manualSelectedTypeId === null) {
          this.manualSelectedTypeId = this.documentTypes[0].id;
        }
        this.isLoadingTypes = false;
      });
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.[0]) return;

    const f = input.files[0];
    this.file.set(f);
    this.uploaded.set(false);
    this.isUploaded = false; // <-- Reset on file change
    this.uploadMessage = '';
    this.csvRows = [];
    this.visibleColumns = [];

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      this.csvRows = this.parseCsv(text);
      if (this.csvRows.length > 0) {
        this.visibleColumns = new Array(this.csvRows[0].length).fill(true);
      }
    };
    reader.onerror = () => {
      this.uploadMessage = 'Failed to read file for preview.';
    };
    reader.readAsText(f, 'utf-8');
  }

  parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    if (!text) return rows;

    // Normalize line endings
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    let cur = '';
    let row: string[] = [];
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (ch === '"') {
        // handle double quotes inside quotes
        if (inQuotes && text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        row.push(cur);
        cur = '';
      } else if (ch === '\n' && !inQuotes) {
        row.push(cur);
        rows.push(row.map(cell => (cell ?? '').trim()));
        row = [];
        cur = '';
      } else {
        cur += ch;
      }
    }
    // final cell
    if (cur !== '' || inQuotes || row.length > 0) {
      row.push(cur);
      rows.push(row.map(cell => (cell ?? '').trim()));
    }
    return rows;
  }


  fileName(): string {
    return this.file()?.name ?? '';
  }

  uploadQuestions(): void {
    const f = this.file();
    if (!f) {
      this.uploadMessage = 'Please select a CSV file to upload.';
      return;
    }
    const selected = this.selectedTypeId();

    if (selected === 'new' || selected === null) {
      if (!this.newTypeName || !this.newTypeName.trim()) {
        this.uploadMessage = 'Enter a name for the new document type.';
        return;
      }
      const form = new FormData();
      form.append('name', this.newTypeName.trim());
      form.append('questions_csv', f, f.name);

      this.isUploading = true;
      this.uploadMessage = '';

      this.http.post<{ success: boolean; message?: string; document_type?: DocumentType }>(this.POST_TYPE_ENDPOINT, form)
        .subscribe({
          next: (res) => {
            this.isUploading = false;
            this.isUploaded = !!(res && res.success); // <-- Only set on upload
            if (res && res.success) {
              this.uploaded.set(true);
              this.uploadMessage = res.message ?? 'Created and uploaded successfully';
              this.loadDocumentTypes();
              setTimeout(() => window.location.reload(), 2000);
              if (res.document_type?.id) {
                this.selectedTypeId.set(res.document_type.id);
                this.manualSelectedTypeId = res.document_type.id;
                this.loadCsvPreview(res.document_type.id);
              }
            } else {
              this.uploadMessage = res?.message ?? 'Unexpected response from server';
            }
          },
          error: (err) => {
            this.isUploading = false;
            this.isUploaded = false;
            this.uploadMessage = err?.error?.message || 'Upload failed. Please try again.';
            console.error(err);
          }
        });
      return;
    }

    if (typeof selected === 'number') {
      const form = new FormData();
      form.append('questions_csv', f, f.name);
      this.isUploading = true;
      this.uploadMessage = '';

      const url = `${API_BASE_URL}/document-types/${selected}/questions`;
      this.http.put<{ success: boolean; message?: string }>(url, form)
        .subscribe({
          next: (res) => {
            this.isUploading = false;
            this.isUploaded = !!(res && res.success); // <-- Only set on upload
            if (res && res.success) {
              this.uploaded.set(true);
              this.uploadMessage = res.message ?? 'Questions updated successfully';
              this.loadDocumentTypes();
              setTimeout(() => window.location.reload(), 2000);
              this.loadCsvPreview(selected);
            } else {
              this.uploadMessage = res?.message ?? 'Unexpected response from server';
            }
          },
          error: (err) => {
            this.isUploading = false;
            this.isUploaded = false;
            this.uploadMessage = err?.error?.message || 'Update failed. Please try again.';
            console.error(err);
          }
        });
      return;
    }

    this.uploadMessage = 'Invalid selection. Please choose an existing type or create a new one.';
  }

  loadCsvPreview(typeId: number): void {
    const url = `${API_BASE_URL}/document-types/${typeId}/questions?full=1`;
    this.http.get<{ success: boolean; rows?: string[][]; questions?: string[] }>(url)
      .pipe(catchError(err => {
        console.error('Failed to load server preview', err);
        this.uploadMessage = 'Failed to load preview from server';
        return of(null);
      }))
      .subscribe(res => {
        if (res && res.success) {
          if (Array.isArray(res.rows) && res.rows.length > 0) {
            this.csvRows = res.rows.map(r => r.map(c => (c === null || c === undefined) ? '' : String(c)));
          } else if (Array.isArray(res.questions)) {
            const header = ['Question'];
            this.csvRows = [header, ...res.questions.map(q => [q])];
          } else {
            this.csvRows = [];
          }
          this.visibleColumns = new Array((this.csvRows[0]?.length ?? 0)).fill(true);
          this.uploaded.set(true);
        }
      });
  }

  refreshPreview(): void {
    const id = this.manualSelectedTypeId;
    if (id) this.loadCsvPreview(id);
    this.isUploaded = false; // <-- Reset on preview/refresh
  }

  toggleColumn(i: number): void {
    if (!this.visibleColumns || i < 0 || i >= this.visibleColumns.length) return;
    this.visibleColumns[i] = !this.visibleColumns[i];
  }
  toggleShowAllRows(): void { this.showAllRows = !this.showAllRows; }

  get displayedDataRows(): string[][] {
    if (!this.csvRows || this.csvRows.length <= 1) return [];
    const data = this.csvRows.slice(1);
    return this.showAllRows ? data : data.slice(0, 5);
  }

  get totalQuestions(): number { return Math.max(0, (this.csvRows?.length ?? 0) - 1); }

  clearPreview(): void {
    this.csvRows = [];
    this.visibleColumns = [];
    this.showAllRows = false;
  }

  isColVisible(idx: number): boolean { return !!(this.visibleColumns && this.visibleColumns[idx]); }
}