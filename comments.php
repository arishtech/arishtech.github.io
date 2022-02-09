<?php
/**
 * The template for displaying comments
 *
 * This is the template that displays the area of the page that contains both the current comments
 * and the comment form.
 *
 * @link https://developer.wordpress.org/themes/basics/template-hierarchy/
 *
 * @Package Restly
 * @since 1.0.0
 * 
 */

/*
 * If the current post is protected by a password and
 * the visitor has not yet entered the password we will
 * return early without loading the comments.
 */
if ( post_password_required() ) {
	return;
}
?>

<div id="comments" class="comments-area">
	<?php
		if ( have_comments() ) :
		?>
			<div class="all-comments">
				<h3 class="comments-title">
					<?php restly_comment_count_text(get_the_id()); ?>
				</h3>
				<div class="comment-list">	
					<ul>
						<?php
							wp_list_comments( array(
								'style'      => 'ul',
								'short_ping' => true,
								'callback'   => 'restly_comment'
							));
						?>
					</ul><!-- .comment-list -->
				</div>
			</div>
			
		<?php
			restly_comments_pagination();
			// If comments are closed and there are comments, let's leave a little note, shall we?
			if ( ! comments_open() ) :
				?>
					<p class="no-comments"><?php esc_html_e( 'Comments are closed.', 'restly' ); ?></p>
				<?php
			endif;

		endif; // Check for have_comments().
	?>
	<?php if( comments_open() ) : ?>
	<div class="comment-box">
		<?php comment_form(); ?>
	</div>
	<?php endif; ?>
</div><!-- #comments -->