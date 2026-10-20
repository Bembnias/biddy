import * as React from 'react';
import { cn } from '@/lib/utils';

import { fieldClasses } from './input';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldClasses, 'flex field-sizing-content min-h-32 px-3.5 py-3', className)}
      {...props}
    />
  );
}

export { Textarea };
