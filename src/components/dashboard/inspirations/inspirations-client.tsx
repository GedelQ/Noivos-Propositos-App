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
  query,
  where,
  getDocs,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useWedding } from '@/context/wedding-context';
import { useToast } from '@/hooks/use-toast';
import type { Inspiration, InspirationCategory, InspirationComment } from '@/lib/types';
import Image from 'next/image';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription as AlertDialogDesc, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, PlusCircle, Edit, Trash2, MessageSquare, Send, Link as LinkIcon } from 'lucide-react';
import ImageUploader from '@/components/ui/image-uploader';

const categoryFormSchema = z.object({
  name: z.string().min(3, { message: "O nome da categoria deve ter pelo menos 3 caracteres." }),
});

const inspirationFormSchema = z.object({
  notes: z.string().optional(),
  imageUrl: z.string().url({ message: "É necessário enviar uma imagem." }),
  categoryId: z.string(),
  link: z.string().url({ message: "Por favor, insira um URL válido." }).optional().or(z.literal('')),
});

const commentFormSchema = z.object({
  text: z.string().min(1, { message: "O comentário não pode estar vazio." }),
});

const EmptyState = ({ onAddCategory }: { onAddCategory: () => void }) => (
    <Card className="text-center py-12 border-dashed">
        <CardContent>
            <h3 className="text-lg font-semibold">Seu mural de inspirações está vazio.</h3>
            <p className="text-muted-foreground mt-1 mb-4">Crie sua primeira categoria para começar a adicionar ideias.</p>
            <Button onClick={onAddCategory}>
                <PlusCircle className="mr-2" />
                Criar Categoria
            </Button>
        </CardContent>
    </Card>
);

export default function InspirationsClient() {
  const { toast } = useToast();
  const { activeWeddingId, loading, userProfile, inspirationCategories, inspirations } = useWedding();
  
  // Category Dialog State
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<InspirationCategory | null>(null);

  // Inspiration Dialog State
  const [isInspirationDialogOpen, setIsInspirationDialogOpen] = useState(false);
  const [editingInspiration, setEditingInspiration] = useState<Inspiration | null>(null);

  // Comments Dialog State
  const [viewingInspiration, setViewingInspiration] = useState<Inspiration | null>(null);
  const [comments, setComments] = useState<InspirationComment[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState(false);

  const categoryForm = useForm<z.infer<typeof categoryFormSchema>>({ resolver: zodResolver(categoryFormSchema), defaultValues: { name: '' } });
  const inspirationForm = useForm<z.infer<typeof inspirationFormSchema>>({ resolver: zodResolver(inspirationFormSchema), defaultValues: { notes: '', imageUrl: '', categoryId: '', link: '' } });
  const commentForm = useForm<z.infer<typeof commentFormSchema>>({ resolver: zodResolver(commentFormSchema), defaultValues: { text: '' } });

  useEffect(() => {
    if (editingCategory) categoryForm.reset({ name: editingCategory.name });
  }, [editingCategory, categoryForm]);

  useEffect(() => {
    if (editingInspiration) inspirationForm.reset({ notes: editingInspiration.notes, imageUrl: editingInspiration.imageUrl, categoryId: editingInspiration.categoryId, link: editingInspiration.link || '' });
  }, [editingInspiration, inspirationForm]);
  
  useEffect(() => {
    if (!viewingInspiration || !activeWeddingId) {
      setComments([]);
      return;
    }
    setIsLoadingComments(true);
    const commentsQuery = query(collection(db, 'weddings', activeWeddingId, 'inspirations', viewingInspiration.id, 'comments'));
    const unsubscribe = onSnapshot(commentsQuery, snapshot => {
      setComments(snapshot.docs.map(d => ({id: d.id, ...d.data()}) as InspirationComment).sort((a,b) => a.createdAt.toMillis() - b.createdAt.toMillis()));
      setIsLoadingComments(false);
    });
    return () => unsubscribe();
  }, [viewingInspiration, activeWeddingId]);

  // --- Category Actions ---
  const handleCategorySubmit = async (values: z.infer<typeof categoryFormSchema>) => {
    if (!activeWeddingId) return;
    try {
      if (editingCategory) {
        await updateDoc(doc(db, 'weddings', activeWeddingId, 'inspirationCategories', editingCategory.id), { name: values.name });
        toast({ title: 'Sucesso', description: 'Categoria atualizada.' });
      } else {
        await addDoc(collection(db, 'weddings', activeWeddingId, 'inspirationCategories'), { ...values, createdAt: serverTimestamp() });
        toast({ title: 'Sucesso', description: 'Categoria criada.' });
      }
      setIsCategoryDialogOpen(false);
    } catch (e) { toast({ title: 'Erro', description: 'Não foi possível salvar a categoria.', variant: 'destructive' }) }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    if (!activeWeddingId) return;
    const batch = writeBatch(db);
    // Delete category doc
    batch.delete(doc(db, 'weddings', activeWeddingId, 'inspirationCategories', categoryId));
    // Find and delete all inspirations in that category
    const inspirationsToDeleteQuery = query(collection(db, 'weddings', activeWeddingId, 'inspirations'), where('categoryId', '==', categoryId));
    const inspirationsSnapshot = await getDocs(inspirationsToDeleteQuery);
    inspirationsSnapshot.forEach(d => batch.delete(d.ref));
    await batch.commit();
    toast({ title: 'Sucesso', description: 'Categoria e todas as suas inspirações foram removidas.' });
  };

  // --- Inspiration Actions ---
  const handleInspirationSubmit = async (values: z.infer<typeof inspirationFormSchema>) => {
    if (!activeWeddingId) return;
    try {
      const dataToSave = {
        ...values,
        link: values.link || null,
      };

      if (editingInspiration) {
        await updateDoc(doc(db, 'weddings', activeWeddingId, 'inspirations', editingInspiration.id), dataToSave);
        toast({ title: 'Sucesso', description: 'Inspiração atualizada.' });
      } else {
        await addDoc(collection(db, 'weddings', activeWeddingId, 'inspirations'), { ...dataToSave, createdAt: serverTimestamp() });
        toast({ title: 'Sucesso', description: 'Inspiração adicionada.' });
      }
      setIsInspirationDialogOpen(false);
    } catch (e) { toast({ title: 'Erro', description: 'Não foi possível salvar a inspiração.', variant: 'destructive' }) }
  };

  const handleDeleteInspiration = async (inspirationId: string) => {
    if (!activeWeddingId) return;
    await deleteDoc(doc(db, 'weddings', activeWeddingId, 'inspirations', inspirationId));
    toast({ title: 'Sucesso', description: 'Inspiração removida.' });
  };
  
  // --- Comment Actions ---
  const handleCommentSubmit = async (values: z.infer<typeof commentFormSchema>) => {
    if (!activeWeddingId || !viewingInspiration || !userProfile?.role || !['bride', 'groom'].includes(userProfile.role)) return;
    try {
        await addDoc(collection(db, 'weddings', activeWeddingId, 'inspirations', viewingInspiration.id, 'comments'), {
            text: values.text,
            authorUid: userProfile.id,
            authorName: userProfile.name,
            authorRole: userProfile.role,
            createdAt: serverTimestamp()
        });
        commentForm.reset();
    } catch (e) { toast({ title: 'Erro', description: 'Não foi possível salvar o comentário.', variant: 'destructive' }) }
  }
  
  if (loading) return <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!activeWeddingId) return <div className="text-center p-8 bg-card rounded-lg">Por favor, selecione um casamento.</div>;

  return (
    <div className="space-y-6">
      {inspirationCategories.length === 0 ? (
        <EmptyState onAddCategory={() => setIsCategoryDialogOpen(true)} />
      ) : (
        <Tabs defaultValue={inspirationCategories[0].id} className="w-full">
            <div className="flex flex-col sm:flex-row gap-4 justify-between items-start">
              <TabsList className="overflow-x-auto overflow-y-hidden">
                {inspirationCategories.map(cat => (
                  <TabsTrigger key={cat.id} value={cat.id}>{cat.name}</TabsTrigger>
                ))}
              </TabsList>
              <Button onClick={() => { setEditingCategory(null); setIsCategoryDialogOpen(true); }}>
                <PlusCircle className="mr-2"/> Gerenciar Categorias
              </Button>
            </div>
            {inspirationCategories.map(cat => (
              <TabsContent key={cat.id} value={cat.id} className="mt-6">
                <div className="flex justify-end mb-4">
                  <Button onClick={() => { setEditingInspiration(null); inspirationForm.reset({ categoryId: cat.id, imageUrl: '', notes: '', link: '' }); setIsInspirationDialogOpen(true); }}>
                    <PlusCircle className="mr-2" /> Adicionar Inspiração
                  </Button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {inspirations.filter(i => i.categoryId === cat.id).map(insp => (
                    <Card key={insp.id} className="group relative overflow-hidden cursor-pointer" onClick={() => setViewingInspiration(insp)}>
                      <Image src={insp.imageUrl} alt={insp.notes || 'Inspiração'} width={400} height={400} className="object-cover aspect-square bg-muted" data-ai-hint="inspiration item" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-2">
                          <p className="text-white text-sm text-center line-clamp-2">{insp.notes}</p>
                      </div>
                       <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                            <Button variant="secondary" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setEditingInspiration(insp); setIsInspirationDialogOpen(true); }}><Edit className="h-4 w-4" /></Button>
                             <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="destructive" size="icon" className="h-7 w-7" onClick={(e) => e.stopPropagation()}><Trash2 className="h-4 w-4" /></Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader><AlertDialogTitle>Remover Inspiração?</AlertDialogTitle></AlertDialogHeader>
                                    <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteInspiration(insp.id)}>Remover</AlertDialogAction></AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </div>
                    </Card>
                  ))}
                </div>
              </TabsContent>
            ))}
        </Tabs>
      )}

      {/* Category Management Dialog */}
      <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
          <DialogContent>
              <DialogHeader><DialogTitle>Gerenciar Categorias</DialogTitle></DialogHeader>
              <div className="space-y-4 py-4">
              {inspirationCategories.map(cat => (
                <div key={cat.id} className="flex items-center justify-between">
                    <p>{cat.name}</p>
                    <div className="flex gap-2">
                        <Button variant="ghost" size="icon" onClick={() => { setEditingCategory(cat); }}><Edit className="h-4 w-4"/></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="h-4 w-4"/></Button></AlertDialogTrigger>
                          <AlertDialogContent>
                              <AlertDialogHeader><AlertDialogTitle>Remover "{cat.name}"?</AlertDialogTitle><AlertDialogDesc>Todas as inspirações nesta categoria serão perdidas.</AlertDialogDesc></AlertDialogHeader>
                              <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteCategory(cat.id)}>Remover</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                      </AlertDialog>
                    </div>
                </div>
              ))}
              </div>
              <Form {...categoryForm}>
                  <form onSubmit={categoryForm.handleSubmit(handleCategorySubmit)} className="space-y-4 border-t pt-4">
                      <FormField control={categoryForm.control} name="name" render={({ field }) => (
                          <FormItem><FormLabel>{editingCategory ? 'Renomear Categoria' : 'Nova Categoria'}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage/></FormItem>
                      )}/>
                      <DialogFooter>
                          <DialogClose asChild><Button variant="ghost">Fechar</Button></DialogClose>
                          <Button type="submit">{editingCategory ? 'Salvar' : 'Adicionar'}</Button>
                      </DialogFooter>
                  </form>
              </Form>
          </DialogContent>
      </Dialog>
      
      {/* Inspiration Form Dialog */}
      <Dialog open={isInspirationDialogOpen} onOpenChange={setIsInspirationDialogOpen}>
          <DialogContent>
              <DialogHeader><DialogTitle>{editingInspiration ? 'Editar Inspiração' : 'Nova Inspiração'}</DialogTitle></DialogHeader>
              <Form {...inspirationForm}>
                  <form onSubmit={inspirationForm.handleSubmit(handleInspirationSubmit)} className="space-y-4">
                    <FormField control={inspirationForm.control} name="imageUrl" render={() => (
                      <FormItem>
                        <FormLabel>Imagem</FormLabel>
                         <ImageUploader initialImageUrl={inspirationForm.getValues('imageUrl') || null} onUploadComplete={(url) => inspirationForm.setValue('imageUrl', url, { shouldValidate: true })} aspectRatio="aspect-square"/>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={inspirationForm.control} name="notes" render={({ field }) => (
                        <FormItem><FormLabel>Notas (Opcional)</FormLabel><FormControl><Textarea placeholder="Descreva a imagem, o que você gosta nela, etc." {...field}/></FormControl><FormMessage/></FormItem>
                    )}/>
                    <FormField control={inspirationForm.control} name="link" render={({ field }) => (
                        <FormItem><FormLabel>Link de Referência (Opcional)</FormLabel><FormControl><Input placeholder="https://exemplo.com/produto" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <DialogFooter><DialogClose asChild><Button variant="ghost">Cancelar</Button></DialogClose><Button type="submit">Salvar</Button></DialogFooter>
                  </form>
              </Form>
          </DialogContent>
      </Dialog>
      
      {/* View/Comment Dialog */}
      <Dialog open={!!viewingInspiration} onOpenChange={(isOpen) => !isOpen && setViewingInspiration(null)}>
          <DialogContent className="max-w-4xl grid-cols-1 md:grid-cols-2 grid p-0">
              <div className="relative aspect-square">
                {viewingInspiration && <Image src={viewingInspiration.imageUrl} alt={viewingInspiration.notes || 'Inspiração'} layout="fill" className="object-cover md:rounded-l-lg" data-ai-hint="inspiration detail" />}
              </div>
              <div className="flex flex-col p-6">
                <DialogHeader>
                    <DialogTitle>Discussão da Inspiração</DialogTitle>
                    <DialogDescription>{viewingInspiration?.notes}</DialogDescription>
                </DialogHeader>
                 {viewingInspiration?.link && (
                    <a href={viewingInspiration.link} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" className="mt-4">
                            <LinkIcon className="mr-2" />
                            Visitar Link
                        </Button>
                    </a>
                )}
                <div className="flex-1 my-4 space-y-4 overflow-y-auto pr-2">
                    {isLoadingComments ? <Loader2 className="animate-spin mx-auto"/> : comments.map(comment => (
                        <div key={comment.id} className="flex gap-2">
                           <div className={`text-xs px-2 py-1 rounded-full font-semibold ${comment.authorRole === 'bride' ? 'bg-primary/20 text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>
                                {comment.authorName || comment.authorRole}
                           </div>
                           <p className="flex-1 text-sm bg-muted p-2 rounded-md">{comment.text}</p>
                        </div>
                    ))}
                </div>
                 <Form {...commentForm}>
                  <form onSubmit={commentForm.handleSubmit(handleCommentSubmit)} className="flex items-center gap-2 border-t pt-4">
                      <FormField control={commentForm.control} name="text" render={({ field }) => (
                          <FormItem className="flex-1"><FormControl><Input placeholder="Adicionar comentário..." {...field} /></FormControl></FormItem>
                      )}/>
                      <Button type="submit" size="icon" disabled={commentForm.formState.isSubmitting}><Send /></Button>
                  </form>
              </Form>
              </div>
          </DialogContent>
      </Dialog>
    </div>
  );
}
