'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useWedding } from '@/context/wedding-context';
import { useToast } from '@/hooks/use-toast';
import { triggerWebhook } from '@/app/actions/webhook-actions';
import type { GiftSuggestion, ReceivedGift } from '@/lib/types';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, PlusCircle, Edit, Trash2, Gift, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';


const suggestionFormSchema = z.object({
  name: z.string().min(3, { message: 'O nome do presente deve ter pelo menos 3 caracteres.' }),
  description: z.string().optional(),
});

const receivedGiftFormSchema = z.object({
  giftName: z.string().min(2, "O nome do presente é obrigatório."),
  giverName: z.string().optional(),
  isAnonymous: z.boolean(),
}).refine(data => data.isAnonymous || (data.giverName && data.giverName.trim().length > 1), {
    message: "O nome de quem presenteou é obrigatório, a menos que seja anônimo.",
    path: ["giverName"],
});


export default function GiftsClient() {
  const { toast } = useToast();
  const { activeWeddingId, loading, userProfile, giftSuggestions: suggestions, receivedGifts } = useWedding();

  const [isSuggestionDialogOpen, setIsSuggestionDialogOpen] = useState(false);
  const [editingSuggestion, setEditingSuggestion] = useState<GiftSuggestion | null>(null);
  
  const [isReceivedGiftDialogOpen, setIsReceivedGiftDialogOpen] = useState(false);
  const [editingReceivedGift, setEditingReceivedGift] = useState<ReceivedGift | null>(null);
  
  const [suggestionToReceive, setSuggestionToReceive] = useState<GiftSuggestion | null>(null);

  const suggestionForm = useForm<z.infer<typeof suggestionFormSchema>>({
    resolver: zodResolver(suggestionFormSchema),
    defaultValues: { name: '', description: '' },
  });

  const receivedGiftForm = useForm<z.infer<typeof receivedGiftFormSchema>>({
    resolver: zodResolver(receivedGiftFormSchema),
    defaultValues: { giftName: '', giverName: '', isAnonymous: false },
  });

  const isGuest = userProfile?.role === 'guest';

  useEffect(() => {
    if (isSuggestionDialogOpen) {
      suggestionForm.reset(editingSuggestion ? { name: editingSuggestion.name, description: editingSuggestion.description } : { name: '', description: '' });
    } else {
        setEditingSuggestion(null);
    }
  }, [isSuggestionDialogOpen, editingSuggestion, suggestionForm]);
  
  useEffect(() => {
    if (isReceivedGiftDialogOpen) {
        if (suggestionToReceive) {
             receivedGiftForm.reset({ giftName: suggestionToReceive.name, giverName: userProfile?.name || '', isAnonymous: false });
        } else if (editingReceivedGift) {
            receivedGiftForm.reset({ giftName: editingReceivedGift.giftName, giverName: editingReceivedGift.giverName, isAnonymous: editingReceivedGift.isAnonymous });
        } else {
            receivedGiftForm.reset({ giftName: '', giverName: userProfile?.name || '', isAnonymous: false });
        }
    } else {
        setEditingReceivedGift(null);
        setSuggestionToReceive(null);
    }
  }, [isReceivedGiftDialogOpen, editingReceivedGift, suggestionToReceive, receivedGiftForm, userProfile]);


  const handleSuggestionSubmit = async (values: z.infer<typeof suggestionFormSchema>) => {
    if (!activeWeddingId) return;
    try {
      if (editingSuggestion) {
        await updateDoc(doc(db, 'weddings', activeWeddingId, 'giftSuggestions', editingSuggestion.id), values);
        toast({ title: 'Sucesso', description: 'Sugestão atualizada.' });
      } else {
        await addDoc(collection(db, 'weddings', activeWeddingId, 'giftSuggestions'), { ...values, claimed: false, createdAt: serverTimestamp() });
        toast({ title: 'Sucesso', description: 'Sugestão adicionada.' });
      }
      setIsSuggestionDialogOpen(false);
    } catch (error) {
      toast({ title: 'Erro', description: 'Não foi possível salvar a sugestão.', variant: 'destructive' });
    }
  };
  
  const handleDeleteSuggestion = async (id: string) => {
      if(!activeWeddingId) return;
      try {
          await deleteDoc(doc(db, 'weddings', activeWeddingId, 'giftSuggestions', id));
          toast({ title: 'Sucesso', description: 'Sugestão removida.' });
      } catch (error) {
          toast({ title: 'Erro', description: 'Não foi possível remover a sugestão.', variant: 'destructive' });
      }
  };
  
  const handleReceivedGiftSubmit = async (values: z.infer<typeof receivedGiftFormSchema>) => {
      if (!activeWeddingId) return;
      try {
          const dataToSave = {
              giftName: values.giftName,
              giverName: values.isAnonymous ? 'Anônimo' : values.giverName!,
              isAnonymous: values.isAnonymous,
          };

          if (editingReceivedGift) {
              await updateDoc(doc(db, 'weddings', activeWeddingId, 'receivedGifts', editingReceivedGift.id), dataToSave);
              toast({ title: 'Sucesso', description: 'Presente atualizado no mural.' });
          } else if (suggestionToReceive) {
              const batch = writeBatch(db);
              
              const receivedGiftRef = doc(collection(db, 'weddings', activeWeddingId, 'receivedGifts'));
              batch.set(receivedGiftRef, { ...dataToSave, createdAt: serverTimestamp() });
              
              const suggestionRef = doc(db, 'weddings', activeWeddingId, 'giftSuggestions', suggestionToReceive.id);
              batch.update(suggestionRef, { claimed: true });
              
              await batch.commit();
              toast({ title: 'Sucesso', description: 'Presente adicionado ao mural!' });
          } else {
              await addDoc(collection(db, 'weddings', activeWeddingId, 'receivedGifts'), { ...dataToSave, createdAt: serverTimestamp() });
              toast({ title: 'Sucesso', description: 'Presente adicionado ao mural.' });
          }
          
          triggerWebhook(activeWeddingId, 'giftReceived', dataToSave);
          setIsReceivedGiftDialogOpen(false);

      } catch (error) {
          console.error(error);
          toast({ title: 'Erro', description: 'Não foi possível salvar o presente.', variant: 'destructive' });
      }
  };

  const handleDeleteReceivedGift = async (id: string) => {
      if(!activeWeddingId) return;
      try {
          await deleteDoc(doc(db, 'weddings', activeWeddingId, 'receivedGifts', id));
          toast({ title: 'Sucesso', description: 'Presente removido do mural.' });
      } catch (error) {
          toast({ title: 'Erro', description: 'Não foi possível remover o presente.', variant: 'destructive' });
      }
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  
  if (!activeWeddingId) {
    return <div className="text-center p-8 bg-card rounded-lg">Por favor, selecione um casamento para gerenciar os presentes.</div>;
  }

  return (
    <div className="space-y-6">
       <Tabs defaultValue="mural">
        <div className="flex justify-between items-start">
            <TabsList>
                <TabsTrigger value="mural"><Gift className="mr-2"/>Mural do Carinho</TabsTrigger>
                <TabsTrigger value="sugestoes">Sugestões de Presentes</TabsTrigger>
            </TabsList>
            {!isGuest && (
                <Button onClick={() => setIsSuggestionDialogOpen(true)}>
                    <PlusCircle className="mr-2" />
                    Adicionar Sugestão
                </Button>
            )}
        </div>

        <TabsContent value="mural">
            <div className="flex justify-end mb-4">
                 <Button onClick={() => setIsReceivedGiftDialogOpen(true)} variant="outline">
                    <PlusCircle className="mr-2" />
                    {isGuest ? 'Presentear com um item da sua escolha' : 'Adicionar Presente Manualmente'}
                </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {receivedGifts.length > 0 ? receivedGifts.map(gift => (
                    <Card key={gift.id} className="bg-card shadow-lg flex flex-col">
                        <CardHeader>
                            <CardTitle className="font-headline text-xl">{gift.giftName}</CardTitle>
                            <CardDescription>De: {gift.giverName}</CardDescription>
                        </CardHeader>
                        {!isGuest && (
                            <CardFooter className="mt-auto flex justify-end gap-2">
                                <Button variant="ghost" size="icon" onClick={() => { setEditingReceivedGift(gift); setIsReceivedGiftDialogOpen(true); }}>
                                    <Edit className="h-4 w-4" />
                                </Button>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader><AlertDialogTitle>Remover do Mural?</AlertDialogTitle><AlertDialogDescription>Esta ação é permanente.</AlertDialogDescription></AlertDialogHeader>
                                        <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteReceivedGift(gift.id)}>Remover</AlertDialogAction></AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </CardFooter>
                        )}
                    </Card>
                )) : (
                    <div className="col-span-full">
                        <Card className="text-center py-12 border-dashed">
                            <CardContent><h3 className="text-lg font-semibold">O Mural do Carinho está vazio.</h3><p className="text-muted-foreground mt-1">Adicione presentes manualmente ou marque-os a partir da sua lista de sugestões.</p></CardContent>
                        </Card>
                    </div>
                )}
            </div>
        </TabsContent>

        <TabsContent value="sugestoes">
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                 {suggestions.length > 0 ? suggestions.map(suggestion => (
                    <Card key={suggestion.id} className={cn("bg-card shadow-lg flex flex-col", suggestion.claimed && "opacity-60 bg-muted/50")}>
                        <CardHeader>
                            <CardTitle className="font-headline text-xl">{suggestion.name}</CardTitle>
                            {suggestion.description && <CardDescription>{suggestion.description}</CardDescription>}
                        </CardHeader>
                        <CardFooter className="mt-auto flex justify-between items-center">
                            {suggestion.claimed ? (
                                <div className="flex items-center text-sm text-green-600 font-semibold"><CheckCircle2 className="mr-2 h-5 w-5"/> Já foi presenteado</div>
                            ) : (
                                <Button onClick={() => { setSuggestionToReceive(suggestion); setIsReceivedGiftDialogOpen(true); }}>Presentear</Button>
                            )}
                            {!isGuest && (
                                <div className="flex gap-1">
                                    <Button variant="ghost" size="icon" disabled={suggestion.claimed} onClick={() => { setEditingSuggestion(suggestion); setIsSuggestionDialogOpen(true); }}>
                                        <Edit className="h-4 w-4" />
                                    </Button>
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" disabled={suggestion.claimed}><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader><AlertDialogTitle>Remover Sugestão?</AlertDialogTitle><AlertDialogDescription>Esta ação é permanente.</AlertDialogDescription></AlertDialogHeader>
                                            <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteSuggestion(suggestion.id)}>Remover</AlertDialogAction></AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </div>
                            )}
                        </CardFooter>
                    </Card>
                )) : (
                     <div className="col-span-full">
                        <Card className="text-center py-12 border-dashed">
                            <CardContent><h3 className="text-lg font-semibold">Nenhuma sugestão criada.</h3><p className="text-muted-foreground mt-1">O casal ainda não adicionou sugestões de presentes.</p></CardContent>
                        </Card>
                    </div>
                )}
             </div>
        </TabsContent>
      </Tabs>
      
      {/* Suggestion Form Dialog */}
      <Dialog open={isSuggestionDialogOpen} onOpenChange={setIsSuggestionDialogOpen}>
        <DialogContent>
            <DialogHeader><DialogTitle>{editingSuggestion ? 'Editar Sugestão' : 'Nova Sugestão de Presente'}</DialogTitle></DialogHeader>
            <Form {...suggestionForm}>
                <form onSubmit={suggestionForm.handleSubmit(handleSuggestionSubmit)} className="space-y-4">
                    <FormField control={suggestionForm.control} name="name" render={({ field }) => (
                        <FormItem><FormLabel>Nome do Presente</FormLabel><FormControl><Input placeholder="Ex: Jogo de panelas" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={suggestionForm.control} name="description" render={({ field }) => (
                        <FormItem><FormLabel>Descrição (Opcional)</FormLabel><FormControl><Textarea placeholder="Detalhes, cor, link, etc." {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                     <DialogFooter>
                        <DialogClose asChild><Button type="button" variant="ghost">Cancelar</Button></DialogClose>
                        <Button type="submit">Salvar</Button>
                    </DialogFooter>
                </form>
            </Form>
        </DialogContent>
      </Dialog>
      
      {/* Received Gift Form Dialog */}
      <Dialog open={isReceivedGiftDialogOpen} onOpenChange={setIsReceivedGiftDialogOpen}>
        <DialogContent>
            <DialogHeader><DialogTitle>{editingReceivedGift ? 'Editar Presente' : 'Registrar Presente Recebido'}</DialogTitle></DialogHeader>
            <Form {...receivedGiftForm}>
                <form onSubmit={receivedGiftForm.handleSubmit(handleReceivedGiftSubmit)} className="space-y-4">
                    <FormField control={receivedGiftForm.control} name="giftName" render={({ field }) => (
                        <FormItem><FormLabel>Nome do Presente</FormLabel><FormControl><Input {...field} disabled={!!suggestionToReceive} /></FormControl><FormMessage /></FormItem>
                    )} />
                     <FormField control={receivedGiftForm.control} name="giverName" render={({ field }) => (
                        <FormItem><FormLabel>Seu nome (ou do grupo)</FormLabel><FormControl><Input placeholder="Ex: Maria e José" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                     <FormField control={receivedGiftForm.control} name="isAnonymous" render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow">
                           <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                           <div className="space-y-1 leading-none">
                            <FormLabel>Quero que seja um presente anônimo</FormLabel>
                            <FormMessage />
                           </div>
                        </FormItem>
                     )} />
                    <DialogFooter>
                        <DialogClose asChild><Button type="button" variant="ghost">Cancelar</Button></DialogClose>
                        <Button type="submit">Adicionar ao Mural</Button>
                    </DialogFooter>
                </form>
            </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
