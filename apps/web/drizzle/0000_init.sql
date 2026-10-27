CREATE TABLE "blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"boundary" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"server_seq" bigserial NOT NULL,
	"tree_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"created_at" text NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_server_seq_unique" UNIQUE("server_seq")
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tag" text NOT NULL,
	"tag_number" integer NOT NULL,
	"prefix" text NOT NULL,
	"block_id" text,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"accuracy_m" double precision DEFAULT 0 NOT NULL,
	"fix_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'standing' NOT NULL,
	"voided" boolean DEFAULT false NOT NULL,
	"species" text,
	"dbh_cm" double precision,
	"height_m" double precision,
	"height_source" text,
	"straightness" integer,
	"twist" integer,
	"branchiness" integer,
	"defects" text,
	"leave_tree" boolean,
	"notes" text,
	"stump_diameter_cm" double precision,
	"created_by" text NOT NULL,
	"device_id" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"tag_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "events_tree_idx" ON "events" USING btree ("tree_id");--> statement-breakpoint
CREATE INDEX "events_device_idx" ON "events" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "events_hash_idx" ON "events" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "trees_block_idx" ON "trees" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "trees_prefix_idx" ON "trees" USING btree ("prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tag_prefix_idx" ON "users" USING btree ("tag_prefix");