import { useCallback } from 'react';
import { motion } from 'framer-motion';
import { Upload, FileSpreadsheet, Loader2 } from 'lucide-react';
import { useAppContext } from '@/context/AppContext';

export default function UploadScreen() {
  const { loadFile, loading, loadingProgress, loadingMessage } = useAppContext();
  // A load that ended in an error leaves its message here; a new load replaces it.
  const loadError = !loading && /^(Error|Worker error):/.test(loadingMessage) ? loadingMessage : '';

  const handleFile = useCallback((file: File) => {
    //if (file.size > 157286400) {
     // alert('File exceeds 150MB limit. Please split into smaller files.');
      //return;
    //}
    loadFile(file, file.name);
  }, [loadFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="max-w-lg w-full text-center"
      >
        <h1 className="font-mono text-xl font-bold text-foreground mb-1">
          Work Notes Quality
        </h1>
        <p className="text-muted-foreground text-sm mb-8">
          Incident documentation intelligence for IT operations
        </p>

        {loading ? (
          <div className="v1-card p-12 flex flex-col items-center gap-6 bg-muted">
            <div className="w-full">
              <div className="flex justify-between text-xs text-muted-foreground mb-2">
                <span>{loadingMessage || 'Starting...'}</span>
                <span>{loadingProgress}%</span>
              </div>
              <div className="w-full bg-background rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${loadingProgress}%` }}
                />
              </div>
            </div>
            <p className="text-muted-foreground text-xs">
              Do not close this tab while processing
            </p>
          </div>
        ) : (
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="v1-card-hover p-12 cursor-pointer group border-dashed"
          >
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleChange}
              className="hidden"
              id="file-upload"
            />
            <label htmlFor="file-upload" className="cursor-pointer">
                <div className="w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-4 transition-colors text-primary-foreground bg-secondary">
                <Upload className="w-6 h-6 text-primary" />
              </div>
              <p className="text-card-foreground font-medium mb-1">
                Drop your incident export here
              </p>
              <p className="text-card-foreground/60 text-xs">
                .xlsx, .xls, or .csv from ServiceNow
              </p>
            </label>
          </div>
        )}

        {loadError && (
          <p role="alert" className="mt-4 rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-left text-sm text-foreground">
            {loadError}
          </p>
        )}

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mt-8 v1-card p-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <FileSpreadsheet className="w-4 h-4 text-card-foreground/60" />
            <span className="font-mono text-xs text-card-foreground/60 uppercase tracking-wider">Expected Columns</span>
          </div>
          <p className="text-xs text-card-foreground/70 leading-relaxed">
            Number · Priority · State · Short description · Description · Work notes · Assignment group · Assigned to · Opened · Closed · Channel · Made SLA
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
