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

#pragma comment(lib, "ws2_32.lib")

#define BUF_SIZE 2048

struct frame_t {
	long int ID;
	long int length;
	char data[BUF_SIZE];
};

static void print_error(char *msg)
{
	fprintf(stderr, "%s: %d\n", msg, WSAGetLastError());
	exit(EXIT_FAILURE);
}

int main(int argc, char **argv)
{
	WSADATA wsaData;
	SOCKET cfd;
	struct sockaddr_in send_addr, from_addr;
	struct _stat64i32 st;
	struct frame_t frame;
	
	char cmd_send[50];
	char flname[20];
	char cmd[10];
	
	int numRead = 0;
	int length = 0;
	long int f_size = 0;
	long int ack_num = 0;
	int ack_recv = 0;
	FILE *fptr;
	
	if (argc != 3) {
		printf("Client: Usage --> %s [IP Address] [Port Number]\n", argv[0]);
		exit(EXIT_FAILURE);
	}
	
	if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
		fprintf(stderr, "WSAStartup failed\n");
		exit(EXIT_FAILURE);
	}
	
	memset(&send_addr, 0, sizeof(send_addr));
	memset(&from_addr, 0, sizeof(from_addr));
	
	send_addr.sin_family = AF_INET;
	send_addr.sin_port = htons(atoi(argv[2]));
	send_addr.sin_addr.s_addr = inet_addr(argv[1]);
	
	if ((cfd = socket(AF_INET, SOCK_DGRAM, 0)) == INVALID_SOCKET)
		print_error("Client: socket");
	
	printf("Client connected to %s:%s\n", argv[1], argv[2]);
	
	for (;;) {
		memset(cmd_send, 0, sizeof(cmd_send));
		memset(cmd, 0, sizeof(cmd));
		memset(flname, 0, sizeof(flname));
		
		printf("\n===== Menu =====\n");
		printf("Enter any of the following commands:\n");
		printf("  1.) get [file_name]\n");
		printf("  2.) put [file_name]\n");
		printf("  3.) delete [file_name]\n");
		printf("  4.) ls\n");
		printf("  5.) exit\n");
		printf("Command: ");
		
		fgets(cmd_send, sizeof(cmd_send), stdin);
		cmd_send[strcspn(cmd_send, "\n")] = 0;
		
		sscanf(cmd_send, "%s %s", cmd, flname);
		
		if (sendto(cfd, cmd_send, sizeof(cmd_send), 0, (struct sockaddr *)&send_addr, sizeof(send_addr)) == SOCKET_ERROR) {
			print_error("Client: send");
		}
		
		/* GET case */
		if ((strcmp(cmd, "get") == 0) && (flname[0] != '\0')) {
			long int total_frame = 0;
			long int bytes_rec = 0, i = 0;
			
			DWORD timeout = 2000;
			setsockopt(cfd, SOL_SOCKET, SO_RCVTIMEO, (char *)&timeout, sizeof(timeout));
			
			length = sizeof(from_addr);
			recvfrom(cfd, (char *)&total_frame, sizeof(total_frame), 0, (struct sockaddr *)&from_addr, &length);
			
			timeout = 0;
			setsockopt(cfd, SOL_SOCKET, SO_RCVTIMEO, (char *)&timeout, sizeof(timeout));
			
			if (total_frame > 0) {
				sendto(cfd, (char *)&total_frame, sizeof(total_frame), 0, (struct sockaddr *)&send_addr, sizeof(send_addr));
				printf("Total frames to receive: %ld\n", total_frame);
				
				fptr = fopen(flname, "wb");
				
				for (i = 1; i <= total_frame; i++) {
					memset(&frame, 0, sizeof(frame));
					
					recvfrom(cfd, (char *)&frame, sizeof(frame), 0, (struct sockaddr *)&from_addr, &length);
					sendto(cfd, (char *)&frame.ID, sizeof(frame.ID), 0, (struct sockaddr *)&send_addr, sizeof(send_addr));
					
					if ((frame.ID < i) || (frame.ID > i))
						i--;
					else {
						fwrite(frame.data, 1, frame.length, fptr);
						printf("frame.ID --> %ld  frame.length --> %ld\n", frame.ID, frame.length);
						bytes_rec += frame.length;
					}
					
					if (i == total_frame) {
						printf("File received successfully!\n");
					}
				}
				printf("Total bytes received --> %ld\n", bytes_rec);
				fclose(fptr);
			}
			else {
				printf("File is empty or not found\n");
			}
		}
		
		/* PUT case */
		else if ((strcmp(cmd, "put") == 0) && (flname[0] != '\0')) {
			if (_access(flname, 0) == 0) {
				int total_frame = 0, resend_frame = 0, drop_frame = 0, t_out_flag = 0;
				long int i = 0;
				
				_stat(flname, &st);
				f_size = st.st_size;
				
				DWORD timeout = 2000;
				setsockopt(cfd, SOL_SOCKET, SO_RCVTIMEO, (char *)&timeout, sizeof(timeout));
				
				fptr = fopen(flname, "rb");
				
				if ((f_size % BUF_SIZE) != 0)
					total_frame = (f_size / BUF_SIZE) + 1;
				else
					total_frame = (f_size / BUF_SIZE);
				
				printf("Total number of packets --> %d  File size --> %ld\n", total_frame, f_size);
				
				length = sizeof(from_addr);
				sendto(cfd, (char *)&total_frame, sizeof(total_frame), 0, (struct sockaddr *)&send_addr, sizeof(send_addr));
				recvfrom(cfd, (char *)&ack_num, sizeof(ack_num), 0, (struct sockaddr *)&from_addr, &length);
				
				printf("Ack num --> %ld\n", ack_num);
				
				while (ack_num != total_frame) {
					sendto(cfd, (char *)&total_frame, sizeof(total_frame), 0, (struct sockaddr *)&send_addr, sizeof(send_addr));
					recvfrom(cfd, (char *)&ack_num, sizeof(ack_num), 0, (struct sockaddr *)&from_addr, &length);
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
					
					sendto(cfd, (char *)&frame, sizeof(frame), 0, (struct sockaddr *)&send_addr, sizeof(send_addr));
					recvfrom(cfd, (char *)&ack_num, sizeof(ack_num), 0, (struct sockaddr *)&from_addr, &length);
					
					while (ack_num != frame.ID) {
						sendto(cfd, (char *)&frame, sizeof(frame), 0, (struct sockaddr *)&send_addr, sizeof(send_addr));
						recvfrom(cfd, (char *)&ack_num, sizeof(ack_num), 0, (struct sockaddr *)&from_addr, &length);
						printf("frame --> %ld dropped, %d times\n", frame.ID, ++drop_frame);
						resend_frame++;
						if (resend_frame == 200) {
							t_out_flag = 1;
							break;
						}
					}
					drop_frame = 0;
					resend_frame = 0;
					
					if (t_out_flag == 1) {
						printf("File not sent\n");
						break;
					}
					
					printf("frame --> %ld  Ack --> %ld\n", i, ack_num);
					
					if (total_frame == ack_num)
						printf("File sent successfully!\n");
				}
				fclose(fptr);
				
				timeout = 0;
				setsockopt(cfd, SOL_SOCKET, SO_RCVTIMEO, (char *)&timeout, sizeof(timeout));
			}
			else {
				printf("File not found: %s\n", flname);
			}
		}
		
		/* DELETE case */
		else if ((strcmp(cmd, "delete") == 0) && (flname[0] != '\0')) {
			length = sizeof(from_addr);
			ack_recv = 0;
			
			if ((numRead = recvfrom(cfd, (char *)&ack_recv, sizeof(ack_recv), 0, (struct sockaddr *)&from_addr, &length)) < 0)
				print_error("recvfrom");
			
			if (ack_recv > 0)
				printf("Client: File deleted successfully\n");
			else if (ack_recv < 0)
				printf("Client: Invalid file name\n");
			else
				printf("Client: File does not have appropriate permission\n");
		}
		
		/* LS case */
		else if (strcmp(cmd, "ls") == 0) {
			char filename[200];
			memset(filename, 0, sizeof(filename));
			
			length = sizeof(from_addr);
			
			if ((numRead = recvfrom(cfd, filename, sizeof(filename), 0, (struct sockaddr *)&from_addr, &length)) < 0)
				print_error("recvfrom");
			
			if (filename[0] != '\0') {
				printf("Number of bytes received = %d\n", numRead);
				printf("\n=== List of files and directories ===\n%s\n", filename);
			}
			else {
				printf("Received buffer is empty\n");
			}
		}
		
		/* EXIT case */
		else if (strcmp(cmd, "exit") == 0) {
			closesocket(cfd);
			WSACleanup();
			exit(EXIT_SUCCESS);
		}
		
		/* Invalid case */
		else {
			printf("--------Invalid Command!----------\n");
		}
	}
	
	closesocket(cfd);
	WSACleanup();
	exit(EXIT_SUCCESS);
}
