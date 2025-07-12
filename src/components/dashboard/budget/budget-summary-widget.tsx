'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import type { BudgetItem, WeddingData } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Wallet } from 'lucide-react';

interface BudgetSummaryWidgetProps {
  budgetItems: BudgetItem[];
  weddingData: WeddingData | null;
}

export default function BudgetSummaryWidget({ budgetItems, weddingData }: BudgetSummaryWidgetProps) {
  const { totalActual } = useMemo(() => {
    return budgetItems.reduce(
      (acc, item) => {
        acc.totalActual += item.actualCost;
        return acc;
      },
      { totalActual: 0 }
    );
  }, [budgetItems]);

  const totalBudget = weddingData?.totalBudget || 0;
  const progress = totalBudget > 0 ? (totalActual / totalBudget) * 100 : 0;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-medium">Resumo Financeiro</CardTitle>
        <Wallet className="h-5 w-5 text-muted-foreground" />
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-center items-center text-center">
        {totalBudget > 0 ? (
          <div className="w-full space-y-4">
            <div className="text-3xl font-bold">{formatCurrency(totalActual)}</div>
            <p className="text-sm text-muted-foreground">
              Gasto de um orçamento de {formatCurrency(totalBudget)}
            </p>
            <Progress value={progress} />
          </div>
        ) : (
          <div className="text-muted-foreground py-4">
            {budgetItems.length > 0 ? (
              <p className="text-sm">
                Defina um orçamento total para acompanhar seu progresso.
              </p>
            ) : (
              <p className="text-sm">Nenhuma despesa registrada.</p>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Link href="/dashboard/budget" passHref className="w-full">
          <Button variant="outline" className="w-full">
            Gerenciar orçamento
          </Button>
        </Link>
      </CardFooter>
    </Card>
  );
}
