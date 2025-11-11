/***************************************************************************************************
MIT License - Windows Port

Modified for Windows using Winsock2
****************************************************************************************************/

#define _WIN32_WINNT 0x0600
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <io.h>
#include <direct.h>

#pragma comment(lib, "ws2_32.lib")

#define BUF_SIZE (2048)

struct frame_t {
	long int ID;
	long int length;
	char data[BUF_SIZE];
};

int ls(FILE *f) 
{
	WIN32_FIND_DATA findFileData;
	HANDLE hFind = FindFirstFile(".\\*", &findFileData);
	
	if (hFind == INVALID_HANDLE_VALUE) {
		fprintf(stderr, "FindFirstFile failed\n");
		return -1;
	}
	
	do {
		fprintf(f, "%s\n", findFileData.cFileName);
	} while (FindNextFile(hFind, &findFileData) != 0);
	
	FindClose(hFind);
	return 0;
}

static void print_error(const char *msg)
{
	fprintf(stderr, "%s: %d\n", msg, WSAGetLastError());
	exit(EXIT_FAILURE);
}

int main(int argc, char **argv)
{
	WSADATA wsaData;
	SOCKET sfd;
	struct sockaddr_in sv_addr, cl_addr;
	struct _stat64i32 st;
	struct frame_t frame;
	
	char msg_recv[BUF_SIZE];
	char flname_recv[20];
	char cmd_recv[10];
	
	int numRead;
	int length;
	long int f_size;
	long int ack_num = 0;
	int ack_send = 0;
	FILE *fptr;
	
	if (argc != 2) {
		printf("Usage: %s [Port Number]\n", argv[0]);
		exit(EXIT_FAILURE);
	}
	
	if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
		fprintf(stderr, "WSAStartup failed\n");
		exit(EXIT_FAILURE);
	}
	
	memset(&sv_addr, 0, sizeof(sv_addr));
	sv_addr.sin_family = AF_INET;
	sv_addr.sin_port = htons(atoi(argv[1]));
	sv_addr.sin_addr.s_addr = INADDR_ANY;
	
	if ((sfd = socket(AF_INET, SOCK_DGRAM, 0)) == INVALID_SOCKET)
		print_error("Server: socket");
	
	if (bind(sfd, (struct sockaddr *)&sv_addr, sizeof(sv_addr)) == SOCKET_ERROR)
		print_error("Server: bind");
	
	printf("Server started on port %s\n", argv[1]);
	
	for (;;) {
		printf("\nServer: Waiting for client to connect...\n");
		
		memset(msg_recv, 0, sizeof(msg_recv));
		memset(cmd_recv, 0, sizeof(cmd_recv));
		memset(flname_recv, 0, sizeof(flname_recv));
		
		length = sizeof(cl_addr);
		
		if ((numRead = recvfrom(sfd, msg_recv, BUF_SIZE, 0, (struct sockaddr *)&cl_addr, &length)) == SOCKET_ERROR)
			print_error("Server: recvfrom");
		
		printf("Server: Received message --> %s\n", msg_recv);
		
		sscanf(msg_recv, "%s %s", cmd_recv, flname_recv);
		
		/* GET case */
		if ((strcmp(cmd_recv, "get") == 0) && (flname_recv[0] != '\0')) {
			printf("Server: Get called with file name --> %s\n", flname_recv);
			
			if (_access(flname_recv, 0) == 0) {
				int total_frame = 0, resend_frame = 0, drop_frame = 0, t_out_flag = 0;
				long int i = 0;
				
				_stat(flname_recv, &st);
				f_size = st.st_size;
				
				DWORD timeout = 2000;
				setsockopt(sfd, SOL_SOCKET, SO_RCVTIMEO, (char *)&timeout, sizeof(timeout));
				
				fptr = fopen(flname_recv, "rb");
				
				if ((f_size % BUF_SIZE) != 0)
					total_frame = (f_size / BUF_SIZE) + 1;
				else
					total_frame = (f_size / BUF_SIZE);
				
				printf("Total number of packets --> %d\n", total_frame);
				
				sendto(sfd, (char *)&total_frame, sizeof(total_frame), 0, (struct sockaddr *)&cl_addr, sizeof(cl_addr));
				recvfrom(sfd, (char *)&ack_num, sizeof(ack_num), 0, (struct sockaddr *)&cl_addr, &length);
				
				while (ack_num != total_frame) {
					sendto(sfd, (char *)&total_frame, sizeof(total_frame), 0, (struct sockaddr *)&cl_addr, sizeof(cl_addr));
					recvfrom(sfd, (char *)&ack_num, sizeof(ack_num), 0, (struct sockaddr *)&cl_addr, &length);
					resend_frame++;
					if (resend_frame == 20) {
						t_out_flag = 1;
						break;
					}
				}
				
				for (i = 1; i <= total_frame; i++) {
					memset(&frame, 0, sizeof(frame));
					ack_num = 0;
					frame.ID = i;
					frame.length = fread(frame.data, 1, BUF_SIZE, fptr);
					
					sendto(sfd, (char *)&frame, sizeof(frame), 0, (struct sockaddr *)&cl_addr, sizeof(cl_addr));
					recvfrom(sfd, (char *)&ack_num, sizeof(ack_num), 0, (struct sockaddr *)&cl_addr, &length);
					
					while (ack_num != frame.ID) {
						sendto(sfd, (char *)&frame, sizeof(frame), 0, (struct sockaddr *)&cl_addr, sizeof(cl_addr));
						recvfrom(sfd, (char *)&ack_num, sizeof(ack_num), 0, (struct sockaddr *)&cl_addr, &length);
						printf("frame --> %ld dropped, %d times\n", frame.ID, ++drop_frame);
						resend_frame++;
						if (resend_frame == 200) {
							t_out_flag = 1;
							break;
						}
					}
					
					resend_frame = 0;
					drop_frame = 0;
					
					if (t_out_flag == 1) {
						printf("File not sent\n");
						break;
					}
					
					printf("frame --> %ld  Ack --> %ld\n", i, ack_num);
					
					if (total_frame == ack_num)
						printf("File sent\n");
				}
				fclose(fptr);
				
				timeout = 0;
				setsockopt(sfd, SOL_SOCKET, SO_RCVTIMEO, (char *)&timeout, sizeof(timeout));
			}
			else {
				printf("Invalid Filename\n");
			}
		}
		
		/* PUT case */
		else if ((strcmp(cmd_recv, "put") == 0) && (flname_recv[0] != '\0')) {
			printf("Server: Put called with file name --> %s\n", flname_recv);
			
			long int total_frame = 0, bytes_rec = 0, i = 0;
			
			DWORD timeout = 2000;
			setsockopt(sfd, SOL_SOCKET, SO_RCVTIMEO, (char *)&timeout, sizeof(timeout));
			
			recvfrom(sfd, (char *)&total_frame, sizeof(total_frame), 0, (struct sockaddr *)&cl_addr, &length);
			
			timeout = 0;
			setsockopt(sfd, SOL_SOCKET, SO_RCVTIMEO, (char *)&timeout, sizeof(timeout));
			
			if (total_frame > 0) {
				sendto(sfd, (char *)&total_frame, sizeof(total_frame), 0, (struct sockaddr *)&cl_addr, sizeof(cl_addr));
				printf("Total frame --> %ld\n", total_frame);
				
				fptr = fopen(flname_recv, "wb");
				
				for (i = 1; i <= total_frame; i++) {
					memset(&frame, 0, sizeof(frame));
					
					recvfrom(sfd, (char *)&frame, sizeof(frame), 0, (struct sockaddr *)&cl_addr, &length);
					sendto(sfd, (char *)&frame.ID, sizeof(frame.ID), 0, (struct sockaddr *)&cl_addr, sizeof(cl_addr));
					
					if ((frame.ID < i) || (frame.ID > i)) {
						i--;
					}
					else {
						fwrite(frame.data, 1, frame.length, fptr);
						printf("frame.ID --> %ld  frame.length --> %ld\n", frame.ID, frame.length);
						bytes_rec += frame.length;
					}
					
					if (i == total_frame)
						printf("File received\n");
				}
				printf("Total bytes received --> %ld\n", bytes_rec);
				fclose(fptr);
			}
			else {
				printf("File is empty\n");
			}
		}
		
		/* DELETE case */
		else if ((strcmp(cmd_recv, "delete") == 0) && (flname_recv[0] != '\0')) {
			if (_access(flname_recv, 0) == -1) {
				ack_send = -1;
				sendto(sfd, (char *)&ack_send, sizeof(ack_send), 0, (struct sockaddr *)&cl_addr, sizeof(cl_addr));
			}
			else {
				if (_access(flname_recv, 4) == -1) {
					ack_send = 0;
					sendto(sfd, (char *)&ack_send, sizeof(ack_send), 0, (struct sockaddr *)&cl_addr, sizeof(cl_addr));
				}
				else {
					printf("Filename is %s\n", flname_recv);
					remove(flname_recv);
					ack_send = 1;
					sendto(sfd, (char *)&ack_send, sizeof(ack_send), 0, (struct sockaddr *)&cl_addr, sizeof(cl_addr));
				}
			}
		}
		
		/* LS case */
		else if (strcmp(cmd_recv, "ls") == 0) {
			char file_entry[200];
			memset(file_entry, 0, sizeof(file_entry));
			
			fptr = fopen("a.log", "wb");
			if (ls(fptr) == -1)
				print_error("ls");
			fclose(fptr);
			
			fptr = fopen("a.log", "rb");
			int filesize = fread(file_entry, 1, 200, fptr);
			
			printf("Filesize = %d  %d\n", filesize, (int)strlen(file_entry));
			
			sendto(sfd, file_entry, filesize, 0, (struct sockaddr *)&cl_addr, sizeof(cl_addr));
			
			remove("a.log");
			fclose(fptr);
		}
		
		/* EXIT case */
		else if (strcmp(cmd_recv, "exit") == 0) {
			closesocket(sfd);
			WSACleanup();
			exit(EXIT_SUCCESS);
		}
		
		/* Invalid case */
		else {
			printf("Server: Unknown command. Please try again\n");
		}
	}
	
	closesocket(sfd);
	WSACleanup();
	exit(EXIT_SUCCESS);
}
