"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  message: string;
  onRetry: () => void;
  onClose: () => void;
}

export default function ErrorModal({ open, message, onRetry, onClose }: Props) {
  return (
    <Dialog open={open}>
      <DialogContent className="bg-white dark:bg-gray-900 dark:text-gray-100">
        <DialogHeader>
          <DialogTitle>Error</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-gray-700 dark:text-gray-300">
          {message}
        </p>

        <div className="flex justify-end space-x-2 mt-4">
          <Button
            variant="outline"
            onClick={onClose}
            className="dark:border-gray-700 dark:text-gray-200"
          >
            Close
          </Button>

          <Button
            onClick={onRetry}
            className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            Retry
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
