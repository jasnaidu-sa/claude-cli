/**
 * CategoryProgress Component
 *
 * Displays progress breakdown by category in a table format.
 */

import React from 'react'
import { CheckCircle, XCircle, Clock, Circle } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { CategoryProgressDetail } from '@shared/types'

interface CategoryProgressProps {
  categories: CategoryProgressDetail[]
}

export function CategoryProgress({ categories }: CategoryProgressProps) {
  if (categories.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-4">
        No category data available
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-secondary/50 border-b border-border">
            <th className="text-left py-2 px-3 font-medium">Category</th>
            <th className="text-center py-2 px-3 font-medium w-16">
              <span className="sr-only">Passing</span>
              <CheckCircle className="h-3.5 w-3.5 text-emerald-500 mx-auto" />
            </th>
            <th className="text-center py-2 px-3 font-medium w-16">
              <span className="sr-only">Failing</span>
              <XCircle className="h-3.5 w-3.5 text-red-500 mx-auto" />
            </th>
            <th className="text-center py-2 px-3 font-medium w-16">
              <span className="sr-only">Pending</span>
              <Clock className="h-3.5 w-3.5 text-muted-foreground mx-auto" />
            </th>
            <th className="text-right py-2 px-3 font-medium w-20">Progress</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((category, index) => (
            <tr
              key={category.name}
              className={cn(
                'border-b border-border last:border-0',
                index % 2 === 0 ? 'bg-background' : 'bg-secondary/20'
              )}
            >
              <td className="py-2 px-3">
                <div className="flex items-center gap-2">
                  <Circle className={cn(
                    'h-2 w-2 fill-current',
                    category.percentage === 100 ? 'text-emerald-500' :
                    category.percentage > 0 ? 'text-primary' :
                    'text-muted-foreground'
                  )} />
                  <span className="truncate">{category.name}</span>
                </div>
              </td>
              <td className="py-2 px-3 text-center text-emerald-500 font-medium">
                {category.passing}
              </td>
              <td className="py-2 px-3 text-center text-red-500 font-medium">
                {category.failing > 0 ? category.failing : '-'}
              </td>
              <td className="py-2 px-3 text-center text-muted-foreground font-medium">
                {category.pending > 0 ? category.pending : '-'}
              </td>
              <td className="py-2 px-3 text-right">
                <div className="flex items-center justify-end gap-2">
                  <div className="w-12 h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full transition-all',
                        category.percentage === 100 ? 'bg-emerald-500' : 'bg-primary'
                      )}
                      style={{ width: `${category.percentage}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium w-8 text-right">
                    {category.percentage}%
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
