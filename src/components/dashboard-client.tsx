
'use client';

import { useBuildingStore } from '@/hooks/use-building-store';
import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Building2, Plus, Trash2 } from 'lucide-react';
import { CreateProjectDialog } from './create-project-dialog';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { Label } from './ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth-store';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Skeleton } from './ui/skeleton';

export function DashboardClient() {
  const { projects, actions, isLoading } = useBuildingStore();
  const [isMounted, setIsMounted] = useState(false);
  const router = useRouter();


  const { user, isLoading: isAuthLoading } = useAuth();

  useEffect(() => {
    setIsMounted(true);
    if (!isAuthLoading && user) {
      actions.loadProjects();
    }
  }, [actions, user, isAuthLoading]);



  const handleDeleteProject = (e: React.MouseEvent, projectId: string) => {
    e.preventDefault();
    actions.deleteProject(projectId);
  }

  const handleSignOut = async () => {
    await signOut(auth);
    router.push('/sign-in');
  }

  if (!isMounted || isLoading) {
    return (
      <div className="bg-background min-h-screen">
        <header className="p-4 border-b border-border">
          <div className="container mx-auto flex items-center justify-between">
            <div className='flex items-center gap-2'>
              <Building2 className="text-primary h-6 w-6" />
              <h1 className="text-2xl font-headline font-bold">Key Stone AI</h1>
            </div>
          </div>
        </header>
        <main className="container mx-auto py-8">
          <h2 className="text-xl font-semibold mb-6">Your Projects</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(3)].map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-1/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="bg-background min-h-screen">
      <header className="p-4 border-b border-border">
        <div className="container mx-auto flex items-center justify-between">
          <div className='flex items-center gap-2'>
            <Building2 className="text-primary h-6 w-6" />
            <h1 className="text-2xl font-headline font-bold">Key Stone AI</h1>
          </div>
          <div className="flex items-center gap-4">
            <CreateProjectDialog>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                New Project
              </Button>
            </CreateProjectDialog>
            {user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user.photoURL || ''} alt={user.displayName || 'User'} />
                      <AvatarFallback>{user.displayName?.charAt(0) || 'U'}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">{user.displayName}</p>
                      <p className="text-xs leading-none text-muted-foreground">
                        {user.email}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut}>
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </header>
      <main className="container mx-auto py-8">
        <h2 className="text-xl font-semibold mb-6">Your Projects</h2>
        {projects.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-border rounded-lg">
            <p className="text-muted-foreground mb-4">You have no projects yet.</p>
            <CreateProjectDialog>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Create Your First Project
              </Button>
            </CreateProjectDialog>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...projects].sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()).map(project => (
              <div key={project.id} className="relative group rounded-lg">
                <Link href={`/dashboard/project/${project.id}`} className="block h-full">
                  <Card className={cn("h-full flex flex-col justify-between transition-shadow relative bg-background overflow-hidden",
                    "group-hover:shadow-2xl group-hover:shadow-primary/20",
                    "before:absolute before:inset-0 before:-translate-x-full before:bg-[linear-gradient(90deg,transparent,hsl(var(--primary)/0.2),transparent)]",
                    "before:transition-transform before:duration-700 group-hover:before:translate-x-full before:pointer-events-none"
                  )}>
                    <div>
                      <CardHeader>
                        <CardTitle className="truncate">
                          {project.name}
                        </CardTitle>
                        <CardDescription>
                          {project.plots.length} {project.plots.length === 1 ? 'plot' : 'plots'}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground">
                          Last modified: {formatDistanceToNow(new Date(project.lastModified), { addSuffix: true })}
                        </p>
                      </CardContent>
                    </div>
                    <div className="h-10" />
                  </Card>
                </Link>

                <div className="absolute bottom-3 right-3 z-30">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="text-destructive/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This action cannot be undone. This will permanently delete your
                          project and remove your data from our servers.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel onClick={(e) => e.stopPropagation()}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={(e) => handleDeleteProject(e, project.id)}>
                          Continue
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )
        }
      </main >
    </div >
  );
}
